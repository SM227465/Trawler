import { logger } from "@/common/utils/logger";
import { rclone } from "@/integrations/rclone/client";
import { egressRepository } from "@/modules/egress/egressRepository";
import { uploadRepository } from "@/modules/upload/uploadRepository";
import { egressDelta, groupFor, uploadService } from "@/modules/upload/uploadService";

/**
 * Moves in-flight uploads to a terminal state.
 *
 * Progress is read live from rclone when someone is looking, but nobody may be
 * looking when a transfer finishes — and rclone forgets a job's stats after a
 * while, and forgets everything on restart. Without this, a completed upload
 * would sit at "running" forever and its bytes would never be counted.
 *
 * Runs every minute alongside the egress ingest. Cheap: one query, and one
 * rclone call per genuinely active transfer.
 */
export async function uploadReconcileHandler() {
	const active = await uploadRepository.active();
	if (active.length === 0) return { checked: 0, finished: 0 };

	let finished = 0;

	for (const row of active) {
		// Queued rows are the pump's business, not this loop's — starting one here
		// would walk straight past the concurrency limit. The pump call at the end
		// picks them up, including any the api missed.
		if (row.status === "queued") continue;

		if (row.rcloneJobId === null) continue;

		try {
			const job = await rclone.jobStatus(row.rcloneJobId);
			if (!job.finished) {
				// Keep the persisted byte count moving, so a restart does not reset
				// the visible progress to zero — and bank what moved since the last
				// tick, so a copy that runs for hours is not invisible to the egress
				// guard for all of them.
				const stats = await rclone.groupStats(groupFor(row.id)).catch(() => null);
				if (stats?.bytes) {
					const moved = egressDelta(row, stats.bytes);
					// Watermark first, then bank — the order bankTorrentUpload already
					// uses. A crash in between loses one tick rather than charging the
					// same bytes twice on the next one.
					await uploadRepository.update(row.id, { bytesDone: stats.bytes });
					if (moved > 0) await egressRepository.bankRemoteUpload(moved);
				}
				continue;
			}

			const stats = await rclone.groupStats(groupFor(row.id)).catch(() => null);
			const bytes = stats?.bytes ?? row.bytesDone;
			const moved = egressDelta(row, bytes);

			await uploadRepository.update(row.id, {
				status: job.success ? "completed" : "failed",
				error: job.success ? null : (job.error || "rclone reported a failure").slice(0, 500),
				bytesDone: bytes,
				// Only on success is what moved also what there was to move. A failure
				// keeps the size measured at queue time, so the row can say it died at
				// 14 GB of 38.6 rather than claiming 14 GB was the whole job.
				...(job.success ? { bytesTotal: bytes } : {}),
				finishedAt: new Date(),
			});

			// Banked whether it succeeded or not: a transfer that failed at 90% still
			// sent 90%, and the provider's allowance was spent on it either way.
			if (moved > 0) await egressRepository.bankRemoteUpload(moved);

			finished++;
			logger.info({ uploadId: row.id, success: job.success, bytes }, "upload finished");
		} catch (err) {
			// rclone restarted and lost the job. The transfer is not recoverable
			// and leaving it "running" forever is worse than calling it failed.
			logger.warn({ err, uploadId: row.id }, "upload job no longer known to rclone");
			await uploadRepository.update(row.id, {
				status: "failed",
				error: "The transfer was interrupted",
				finishedAt: new Date(),
			});
			finished++;
		}
	}

	// Whatever just finished has freed a slot, and a queue with nothing pushing
	// it is a queue that stops. This is also the safety net for a row the api
	// queued and never pumped, because it restarted in between.
	await uploadService.pump();

	return { checked: active.length, finished };
}
