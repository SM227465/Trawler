import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { logger } from "@/common/utils/logger";
import { qbt } from "@/integrations/qbittorrent/client";
import { egressStatus } from "@/modules/egress/egressGuard";
import { torrentRepository } from "@/modules/torrent/torrentRepository";
import { safeDiskStats } from "./diskStats";
import { storageRepository } from "./storageRepository";
import { type EvictionSettings, getEvictionSettings, saveEvictionSettings } from "./storageSettings";

/** Arbitrary but fixed — the advisory-lock key for storage.evict. */
const EVICT_LOCK_KEY = 4_812_001;

export interface EvictionOutcome {
	evaluated: boolean;
	reason: string;
	deleted: Array<{ id: string; name: string; sizeBytes: number }>;
	libraryBytes: number;
	freedBytes: number;
	usedPctBefore: number | null;
	usedPctAfter: number | null;
}

export class StorageService {
	async getStatus() {
		const [disk, settings, libraryBytes, egress] = await Promise.all([
			safeDiskStats(),
			getEvictionSettings(),
			storageRepository.torrentsTotalBytes(),
			// Surfaced next to disk because both are "how much room is left",
			// and an egress hard stop is far less obvious than a full disk.
			egressStatus().catch(() => null),
		]);

		const overBudget = settings.budgetBytes > 0 && libraryBytes > settings.budgetBytes;
		const overDisk = disk ? disk.usedPct >= settings.highWatermarkPct : false;

		// What the NEXT pass would delete, in order. Shown in the UI so eviction
		// is never a surprise — the thing that bit us on the very first live run.
		const candidates = await storageRepository.evictionCandidates({
			ttlHours: settings.ttlHours,
			overHighWatermark: overBudget || overDisk,
			limit: 10,
		});

		return ServiceResponse.success("Storage status", {
			disk,
			settings,
			libraryBytes,
			egress,
			pressure: { overBudget, overDisk, active: overBudget || overDisk },
			atRisk: {
				count: candidates.length,
				bytes: candidates.reduce((sum, c) => sum + c.sizeBytes, 0),
				torrents: candidates.map((c) => ({ id: c.id, name: c.name, sizeBytes: c.sizeBytes })),
			},
		});
	}

	async updateSettings(patch: Partial<EvictionSettings>) {
		try {
			const settings = await saveEvictionSettings(patch);
			return ServiceResponse.success("Settings updated", settings);
		} catch (err) {
			return ServiceResponse.failure((err as Error).message, null, ErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
		}
	}

	/**
	 * The user pressing "clean up now". This is the ONLY path that deletes while
	 * automatic eviction is off, and it still honours pins and active shares.
	 */
	async triggerEviction() {
		const result = await this.runEviction(true);
		return ServiceResponse.success("Cleanup complete", result);
	}

	/**
	 * The eviction pass. Two independent triggers (doc 02 §4):
	 *   · TTL — a completed torrent older than ttlHours
	 *   · pressure — disk above the high watermark
	 *
	 * Under pressure it deletes until back under the LOW watermark, not the high
	 * one, so the next write does not immediately re-trigger a pass.
	 */
	/** `force` bypasses the enabled flag — used only by the explicit user action. */
	async runEviction(force = false): Promise<EvictionOutcome> {
		const settings = await getEvictionSettings();
		const out: EvictionOutcome = {
			evaluated: false,
			reason: "",
			deleted: [],
			libraryBytes: 0,
			freedBytes: 0,
			usedPctBefore: null,
			usedPctAfter: null,
		};

		if (!(await storageRepository.tryLock(EVICT_LOCK_KEY))) {
			out.reason = "another eviction pass holds the lock";
			return out;
		}

		try {
			const disk = await safeDiskStats();
			if (!disk) {
				out.reason = "disk stats unavailable";
				return out;
			}

			out.evaluated = true;
			out.usedPctBefore = disk.usedPct;

			// Two independent pressure sources. On Oracle the downloads volume is
			// dedicated, so the disk watermark is the real trigger and the budget
			// is off. On a shared filesystem the budget is what keeps eviction
			// from firing constantly against unrelated data.
			const libraryBytes = await storageRepository.torrentsTotalBytes();
			const overBudget = settings.budgetBytes > 0 && libraryBytes > settings.budgetBytes;
			const overDisk = disk.usedPct >= settings.highWatermarkPct;
			const overHigh = overBudget || overDisk;

			out.libraryBytes = libraryBytes;

			const candidates = await storageRepository.evictionCandidates({
				ttlHours: settings.ttlHours,
				overHighWatermark: overHigh,
			});

			if (candidates.length === 0) {
				out.reason = overHigh
					? "under pressure but nothing is evictable (all pinned, shared, or still downloading)"
					: "nothing past its TTL";
				out.usedPctAfter = disk.usedPct;
				return out;
			}

			// How many bytes this pass must free. When both triggers fire, obey the
			// more demanding one. Both fall back to lowWatermarkPct so a pass does
			// not leave us one byte under the threshold, re-firing five minutes later.
			let needBytes = 0;
			if (overBudget) {
				needBytes = Math.max(needBytes, libraryBytes - settings.budgetBytes * (settings.lowWatermarkPct / 100));
			}
			if (overDisk) {
				needBytes = Math.max(needBytes, disk.totalBytes * (1 - settings.lowWatermarkPct / 100) - disk.freeBytes);
			}
			const targetFreeBytes = needBytes;

			// The safety gate. Disabled is the default: compute what COULD be
			// freed, report it, delete nothing. Only an explicit opt-in (or the
			// manual "clean up now" action) actually removes data.
			if (!settings.enabled && !force) {
				out.reason = `${candidates.length} torrent(s) eligible for cleanup — automatic deletion is off`;
				out.usedPctAfter = disk.usedPct;
				return out;
			}

			let freed = 0;
			for (const c of candidates) {
				if (overHigh && freed >= targetFreeBytes) break;

				try {
					// Through the qBittorrent API, NEVER rm: deleting behind its back
					// leaves its state disagreeing with the filesystem, and it
					// re-checks or re-downloads on next start (doc 02 §4).
					await qbt.remove(c.infoHash, true);
					await torrentRepository.delete(c.id);

					freed += c.sizeBytes;
					out.deleted.push({ id: c.id, name: c.name, sizeBytes: c.sizeBytes });
					logger.info(
						{ torrentId: c.id, name: c.name, sizeBytes: c.sizeBytes, trigger: overHigh ? "pressure" : "ttl" },
						"evicted torrent",
					);
				} catch (err) {
					// One bad torrent must not abort the pass — the next candidate
					// may be exactly the one that relieves the pressure.
					logger.error({ err, torrentId: c.id, name: c.name }, "eviction failed for one torrent");
				}
			}

			out.freedBytes = freed;
			out.reason = overBudget
				? `library ${(libraryBytes / 1e9).toFixed(1)} GB over the ${(settings.budgetBytes / 1e9).toFixed(0)} GB budget`
				: overDisk
					? `disk at ${disk.usedPct.toFixed(1)}% (high ${settings.highWatermarkPct}%)`
					: `${out.deleted.length} torrent(s) past ${settings.ttlHours}h TTL`;

			const after = await safeDiskStats();
			out.usedPctAfter = after?.usedPct ?? null;
			return out;
		} finally {
			await storageRepository.unlock(EVICT_LOCK_KEY);
		}
	}
}

export const storageService = new StorageService();
