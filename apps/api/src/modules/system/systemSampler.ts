import { readFile } from "node:fs/promises";
import os from "node:os";
import { logger } from "@/common/utils/logger";
import { safeDiskStats } from "@/modules/storage/diskStats";
import { qbtPoller } from "@/realtime/qbtPoller";

/**
 * A 1 Hz ring buffer of host metrics. Lives in the api process alongside the
 * qBittorrent poller, for the same reason: that is where the readers are, and
 * CPU percentages require DELTAS between consecutive samples — a per-request
 * calculation would be wrong (and would race between concurrent clients).
 */

const TICK_MS = 1000;
const HISTORY = 90; // 90 s of history at 1 Hz

export interface Sample {
	t: number;
	cpuPct: number;
	perCorePct: number[];
	memUsedBytes: number;
	memTotalBytes: number;
	netRxBps: number;
	netTxBps: number;
	dlBps: number;
	upBps: number;
}

interface CpuTimes {
	idle: number;
	total: number;
}

function cpuTimes(): CpuTimes[] {
	return os.cpus().map((c) => {
		const t = c.times;
		return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
	});
}

/** Container-visible interface counters. Excludes loopback, which is all noise. */
async function netCounters(): Promise<{ rx: number; tx: number }> {
	try {
		const raw = await readFile("/proc/net/dev", "utf8");
		let rx = 0;
		let tx = 0;
		for (const line of raw.split("\n").slice(2)) {
			const [iface, rest] = line.split(":");
			if (!rest || iface.trim() === "lo") continue;
			const cols = rest.trim().split(/\s+/).map(Number);
			rx += cols[0] || 0;
			tx += cols[8] || 0;
		}
		return { rx, tx };
	} catch {
		return { rx: 0, tx: 0 };
	}
}

async function memoryBytes(): Promise<{ used: number; total: number }> {
	try {
		const [maxRaw, curRaw] = await Promise.all([
			readFile("/sys/fs/cgroup/memory.max", "utf8"),
			readFile("/sys/fs/cgroup/memory.current", "utf8"),
		]);
		const max = maxRaw.trim();
		if (max !== "max") {
			const total = Number(max);
			const used = Number(curRaw.trim());
			if (Number.isFinite(total) && Number.isFinite(used)) return { used, total };
		}
	} catch {
		/* not cgroup v2 */
	}
	const total = os.totalmem();
	return { used: total - os.freemem(), total };
}

class SystemSampler {
	private timer: ReturnType<typeof setInterval> | null = null;
	private history: Sample[] = [];
	private prevCpu: CpuTimes[] = cpuTimes();
	private prevNet: { rx: number; tx: number } | null = null;
	private prevAt = Date.now();

	start() {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		this.timer.unref?.();
		logger.info({ tickMs: TICK_MS, history: HISTORY }, "system sampler started");
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	private async tick() {
		try {
			const now = Date.now();
			const elapsedSec = Math.max(0.001, (now - this.prevAt) / 1000);

			// ── cpu, from deltas ──
			const cur = cpuTimes();
			const perCorePct = cur.map((c, i) => {
				const prev = this.prevCpu[i] ?? c;
				const dTotal = c.total - prev.total;
				const dIdle = c.idle - prev.idle;
				if (dTotal <= 0) return 0;
				return Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100));
			});
			this.prevCpu = cur;
			const cpuPct = perCorePct.length ? perCorePct.reduce((a, b) => a + b, 0) / perCorePct.length : 0;

			// ── network, from counter deltas ──
			const net = await netCounters();
			let netRxBps = 0;
			let netTxBps = 0;
			if (this.prevNet) {
				netRxBps = Math.max(0, (net.rx - this.prevNet.rx) / elapsedSec);
				netTxBps = Math.max(0, (net.tx - this.prevNet.tx) / elapsedSec);
			}
			this.prevNet = net;

			const mem = await memoryBytes();
			const qbt = qbtPoller.serverState();

			this.history.push({
				t: now,
				cpuPct,
				perCorePct,
				memUsedBytes: mem.used,
				memTotalBytes: mem.total,
				netRxBps,
				netTxBps,
				dlBps: qbt.dl_info_speed ?? 0,
				upBps: qbt.up_info_speed ?? 0,
			});
			if (this.history.length > HISTORY) this.history.shift();
			this.prevAt = now;
		} catch (err) {
			logger.warn({ err }, "system sample failed");
		}
	}

	snapshot() {
		return this.history;
	}

	latest(): Sample | null {
		return this.history.at(-1) ?? null;
	}

	/** Disk is far slower to read than the rest — sampled on demand, not at 1 Hz. */
	disk() {
		return safeDiskStats();
	}
}

export const systemSampler = new SystemSampler();
