import { readFile } from "node:fs/promises";
import os from "node:os";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { logger } from "@/common/utils/logger";
import { qbt } from "@/integrations/qbittorrent/client";
import { safeDiskStats } from "@/modules/storage/diskStats";
import { systemSampler } from "./systemSampler";

/**
 * Inside a container `os.totalmem()` reports the HOST's RAM, not the cgroup
 * limit — on a 1 GB Oracle box that would show the wrong number entirely. Read
 * the cgroup v2 files when present and fall back to os only outside a container.
 */
async function memoryStats() {
	try {
		const [maxRaw, curRaw] = await Promise.all([
			readFile("/sys/fs/cgroup/memory.max", "utf8"),
			readFile("/sys/fs/cgroup/memory.current", "utf8"),
		]);
		const max = maxRaw.trim();
		// "max" means no limit is set — fall through to the host figures.
		if (max !== "max") {
			const totalBytes = Number(max);
			const usedBytes = Number(curRaw.trim());
			if (Number.isFinite(totalBytes) && Number.isFinite(usedBytes)) {
				return { totalBytes, usedBytes, freeBytes: totalBytes - usedBytes, source: "cgroup" as const };
			}
		}
	} catch {
		/* not cgroup v2, or not containerised */
	}

	const totalBytes = os.totalmem();
	const freeBytes = os.freemem();
	return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes, source: "host" as const };
}

export class SystemService {
	async getStatus() {
		const [disk, memory] = await Promise.all([safeDiskStats(), memoryStats()]);

		const qbtState: { connectionStatus: string; dhtNodes: number; sessionDl: number; sessionUl: number } | null = null;
		let qbtVersion: string | null = null;
		try {
			const [prefsVersion, main] = await Promise.all([qbt.version(), qbt.getTransferLimits()]);
			qbtVersion = prefsVersion;
			void main;
		} catch (err) {
			logger.warn({ err }, "qBittorrent unreachable for system status");
		}

		const cpus = os.cpus();
		const [load1, load5, load15] = os.loadavg();

		return ServiceResponse.success("System status", {
			host: {
				platform: os.platform(),
				arch: os.arch(),
				cpuModel: cpus[0]?.model?.trim() ?? "unknown",
				cpuCount: cpus.length,
				// Load per core is the number that means something across machines.
				load: { one: load1, five: load5, fifteen: load15, perCore: cpus.length ? load1 / cpus.length : 0 },
				uptimeSeconds: os.uptime(),
			},
			memory,
			disk,
			process: {
				uptimeSeconds: process.uptime(),
				rssBytes: process.memoryUsage().rss,
				nodeVersion: process.version,
			},
			services: { qbittorrent: { reachable: qbtVersion !== null, version: qbtVersion }, ...(qbtState ?? {}) },

			// 90 s of 1 Hz samples, sent whole so the client never has to stitch a
			// series together (or get it wrong after a tab switch).
			//
			// perCorePct is STRIPPED from history and kept only on `latest`: the
			// UI draws per-core as current bars, so shipping 90 copies of it
			// tripled the payload for pixels nobody renders. At a 2 s poll that
			// waste is continuous, and on Oracle it is metered egress.
			history: systemSampler.snapshot().map(({ perCorePct: _drop, ...rest }) => rest),
			latest: systemSampler.latest(),
			sampleIntervalMs: 1000,
		});
	}
}

export const systemService = new SystemService();
