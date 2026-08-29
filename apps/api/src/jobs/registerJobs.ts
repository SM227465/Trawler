import type { Job, PgBoss } from "pg-boss";
import { logger } from "@/common/utils/logger";
import { JOB } from "./jobNames";

/**
 * Every queue must be created before anything sends to or works it (pg-boss v10+
 * requires this explicitly). Handlers are registered here and nowhere else, so
 * the full schedule is readable in one place — doc 03 §A9.
 */
export async function registerJobs(boss: PgBoss) {
	await boss.createQueue(JOB.STORAGE_EVICT);

	const { evictHandler } = await import("./handlers/storageEvict");

	// batchSize 1: eviction takes an advisory lock and is not worth parallelising.
	await boss.work(JOB.STORAGE_EVICT, { batchSize: 1 }, async (jobs: Job<object>[]) => {
		for (const _job of jobs) await evictHandler();
	});

	// Every 5 minutes. Cheap when there is nothing to do — one indexed query.
	await boss.schedule(JOB.STORAGE_EVICT, "*/5 * * * *");

	// ── egress accounting ──
	await boss.createQueue(JOB.EGRESS_INGEST);
	const { ingestEgressLog } = await import("@/modules/egress/egressIngest");
	const { invalidateEgressCache } = await import("@/modules/egress/egressGuard");

	await boss.work(JOB.EGRESS_INGEST, { batchSize: 1 }, async (jobs: Job<object>[]) => {
		for (const _job of jobs) {
			const r = await ingestEgressLog();

			// Seeding never touches Caddy — those bytes leave on the torrent port
			// — so the access log cannot see them, but qBittorrent counts them.
			// Poll its all-time upload total and bank the growth. Same tick, so
			// the two halves of the allowance stay in step.
			let seeded = 0;
			try {
				const { qbt } = await import("@/integrations/qbittorrent/client");
				const state = (await qbt.syncMainData(0)).server_state;
				if (typeof state?.alltime_ul === "number") {
					const { egressRepository } = await import("@/modules/egress/egressRepository");
					seeded = await egressRepository.bankTorrentUpload(state.alltime_ul);
				}
			} catch (err) {
				// qBittorrent being briefly unreachable must not stop log ingest.
				logger.warn({ err }, "could not read qBittorrent upload counter");
			}

			if (r.bytes > 0 || seeded > 0) invalidateEgressCache();
		}
	});
	await boss.schedule(JOB.EGRESS_INGEST, "* * * * *");

	// ── external storage ──
	// No queue for STARTING an upload: the api starts it directly, because
	// start() needs only rclone and the database and rclone runs the transfer
	// asynchronously regardless. This is the safety net — terminal state, byte
	// counts, and any row that was created but never started., byte counts and stuck-queue recovery. Every minute: nobody
	// may be watching when a transfer ends, and rclone forgets a job's stats
	// eventually and all of them on restart.
	await boss.createQueue(JOB.UPLOAD_RECONCILE);
	const { uploadReconcileHandler } = await import("./handlers/uploadReconcile");
	await boss.work(JOB.UPLOAD_RECONCILE, { batchSize: 1 }, async (jobs: Job<object>[]) => {
		for (const _job of jobs) await uploadReconcileHandler();
	});
	await boss.schedule(JOB.UPLOAD_RECONCILE, "* * * * *");

	// ── nightly maintenance ──
	await boss.createQueue(JOB.DB_BACKUP);
	const { backupHandler } = await import("./handlers/dbBackup");
	await boss.work(JOB.DB_BACKUP, { batchSize: 1 }, async (jobs: Job<object>[]) => {
		for (const _job of jobs) await backupHandler();
	});
	// 03:17 rather than 03:00 - nothing else competes for the disk at an odd minute.
	await boss.schedule(JOB.DB_BACKUP, "17 3 * * *");

	await boss.createQueue(JOB.LOG_PRUNE);
	const { pruneHandler } = await import("./handlers/logPrune");
	await boss.work(JOB.LOG_PRUNE, { batchSize: 1 }, async (jobs: Job<object>[]) => {
		for (const _job of jobs) await pruneHandler();
	});
	await boss.schedule(JOB.LOG_PRUNE, "42 3 * * *");

	logger.info(
		{ queues: [JOB.STORAGE_EVICT, JOB.EGRESS_INGEST, JOB.DB_BACKUP, JOB.LOG_PRUNE] },
		"job handlers registered",
	);
}
