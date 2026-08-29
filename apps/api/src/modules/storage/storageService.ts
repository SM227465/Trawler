import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { qbt } from "@/integrations/qbittorrent/client";
import { rclone } from "@/integrations/rclone/client";
import { egressStatus } from "@/modules/egress/egressGuard";
import { torrentRepository } from "@/modules/torrent/torrentRepository";
import { uploadRepository } from "@/modules/upload/uploadRepository";
import { uploadService } from "@/modules/upload/uploadService";
import { safeDiskStats } from "./diskStats";
import { storageRepository } from "./storageRepository";
import { type EvictionSettings, getEvictionSettings, saveEvictionSettings } from "./storageSettings";

/**
 * qBittorrent reports an ABSOLUTE content path; uploads address paths relative
 * to the downloads root. Anything outside that root cannot be archived and must
 * not be guessed at — returning null makes the caller skip it rather than
 * upload something unexpected.
 */
export function relativeDownloadPath(contentPath: string | null): string | null {
	if (!contentPath) return null;
	const root = env.DOWNLOADS_DIR.replace(/\/+$/, "");
	if (contentPath === root) return null;
	if (!contentPath.startsWith(`${root}/`)) return null;
	return contentPath.slice(root.length + 1).replace(/^\/+|\/+$/g, "") || null;
}

/** Arbitrary but fixed — the advisory-lock key for storage.evict. */
const EVICT_LOCK_KEY = 4_812_001;

export interface EvictionOutcome {
	/** Queued or still uploading — deliberately NOT deleted on this pass. */
	archiving?: Array<{ id: string; name: string; sizeBytes: number }>;
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
		// A name that does not resolve would look configured and archive nothing,
		// and the first sign of that would be a deleted torrent. Checked here so
		// the mistake is impossible to save rather than merely unlikely.
		if (patch.archiveRemote) {
			const known = await rclone.listRemotes().catch(() => [] as string[]);
			if (!known.includes(patch.archiveRemote)) {
				return ServiceResponse.failure(
					`No storage called "${patch.archiveRemote}" is connected`,
					null,
					ErrorCode.VALIDATION_ERROR,
					"REMOTE_NOT_FOUND",
				);
			}
		}

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
			archiving: [],
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
					// ── archive first, delete later ──────────────────────────────
					// With a remote configured, a torrent is only ever removed once a
					// copy of it has verifiably finished uploading. Uploads are
					// asynchronous, so a pass that starts one does NOT delete on the
					// same pass: it leaves the torrent alone and a later pass, seeing
					// a completed upload, removes it.
					//
					// The ordering is the whole safety property. Deleting first and
					// uploading after would turn a failed transfer into data loss,
					// and the failure mode of getting it wrong is silent.
					if (settings.archiveRemote) {
						const rel = relativeDownloadPath(c.contentPath);
						if (!rel) {
							logger.warn({ torrentId: c.id, name: c.name }, "cannot archive: no usable content path");
							continue;
						}

						const prior = await uploadRepository.latestFor(settings.archiveRemote, rel);

						if (!prior || prior.status === "failed" || prior.status === "cancelled") {
							const queued = await uploadService.queue(settings.archiveRemote, rel);
							if (queued.success) {
								const row = queued.responseObject as { id?: string } | null;
								if (row?.id) void uploadService.start(row.id);
								logger.info(
									{ torrentId: c.id, name: c.name, remote: settings.archiveRemote },
									"archiving before cleanup",
								);
							}
							out.archiving?.push({ id: c.id, name: c.name, sizeBytes: c.sizeBytes });
							continue;
						}

						if (prior.status !== "completed") {
							// Still moving. Leave it; the next pass will find it done.
							out.archiving?.push({ id: c.id, name: c.name, sizeBytes: c.sizeBytes });
							continue;
						}
						// completed — falls through to deletion below
					}

					// Through the qBittorrent API, NEVER rm: deleting behind its back
					// leaves its state disagreeing with the filesystem, and it
					// re-checks or re-downloads on next start (doc 02 §4).
					await qbt.remove(c.infoHash, true);
					await torrentRepository.delete(c.id);

					freed += c.sizeBytes;
					out.deleted.push({ id: c.id, name: c.name, sizeBytes: c.sizeBytes });
					logger.info(
						{
							torrentId: c.id,
							name: c.name,
							sizeBytes: c.sizeBytes,
							trigger: overHigh ? "pressure" : "ttl",
							archivedTo: settings.archiveRemote || null,
						},
						"evicted torrent",
					);
				} catch (err) {
					// One bad torrent must not abort the pass — the next candidate
					// may be exactly the one that relieves the pressure.
					logger.error({ err, torrentId: c.id, name: c.name }, "eviction failed for one torrent");
				}
			}

			out.freedBytes = freed;
			if (out.archiving?.length) {
				out.reason = `${out.archiving.length} torrent(s) uploading to ${settings.archiveRemote} — they are removed once the copy finishes`;
				out.usedPctAfter = (await safeDiskStats())?.usedPct ?? null;
				return out;
			}
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
