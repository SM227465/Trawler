import { PgBoss } from "pg-boss";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";

/**
 * pg-boss owns its own `pgboss` schema in the same Postgres instance. That is
 * the whole reason it was chosen over Redis+BullMQ: one less service to run and
 * back up on a 1 GB box (doc 01), and jobs are transactional with our own data.
 */
let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
	if (!boss) throw new Error("pg-boss not started — call startBoss() first");
	return boss;
}

export async function startBoss(): Promise<PgBoss> {
	if (boss) return boss;

	const instance = new PgBoss({
		connectionString: env.DATABASE_URL,
		// The box is small and the API process holds its own pool. Keep this tight.
		max: 4,
		// Job retention moved to pg-boss's own maintenance defaults in v12; the
		// constructor no longer accepts archive/delete windows. Defaults are fine
		// at this volume (a handful of jobs an hour).
	});

	instance.on("error", (err: unknown) => logger.error({ err }, "pg-boss error"));

	await instance.start();
	boss = instance;
	logger.info("pg-boss started");
	return instance;
}

export async function stopBoss() {
	if (!boss) return;
	// Let in-flight handlers finish; an eviction interrupted mid-delete would
	// leave qBittorrent and the DB disagreeing.
	await boss.stop({ graceful: true });
	boss = null;
	logger.info("pg-boss stopped");
}
