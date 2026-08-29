import { logger } from "@/common/utils/logger";
import { rclone } from "@/integrations/rclone/client";
import { egressRepository } from "@/modules/egress/egressRepository";
import { uploadRepository } from "@/modules/upload/uploadRepository";
import { groupFor, uploadService } from "@/modules/upload/uploadService";

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
		// Queued but never started — the worker died between queueing and start,
		// or the process restarted. Start it now rather than leaving it stuck.
		if (row.status === "queued") {
			await uploadService.start(row.id);
			continue;
		}

		if (row.rcloneJobId === null) continue;

		try {
			const job = await rclone.jobStatus(row.rcloneJobId);
			if (!job.finished) {
				// Keep the persisted byte count moving, so a restart does not reset
				// the visible progress to zero.
				const stats = await rclone.groupStats(groupFor(row.id)).catch(() => null);
				if (stats?.bytes) await uploadRepository.update(row.id, { bytesDone: stats.bytes });
				continue;
			}

			const stats = await rclone.groupStats(groupFor(row.id)).catch(() => null);
			const bytes = stats?.bytes ?? row.bytesDone;

			await uploadRepository.update(row.id, {
				status: job.success ? "completed" : "failed",
				error: job.success ? null : (job.error || "rclone reported a failure").slice(0, 500),
				bytesDone: bytes,
				bytesTotal: bytes,
				finishedAt: new Date(),
			});

			// Only an UPLOAD spends the allowance. A restore is inbound traffic,
			// which providers do not meter — counting it would inflate the number
			// that decides whether this box costs money.
			if (job.success && bytes > 0 && row.direction === "up") {
				await egressRepository.bankRemoteUpload(bytes);
			}

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

	return { checked: active.length, finished };
}
