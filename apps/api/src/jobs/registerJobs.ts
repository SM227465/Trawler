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
			if (r.bytes > 0) invalidateEgressCache();
		}
	});
	await boss.schedule(JOB.EGRESS_INGEST, "* * * * *");

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
