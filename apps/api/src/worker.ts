/**
 * The worker process. Separate from `api` on purpose (doc 03 §A9): background
 * work must never compete with request handling or the 1 Hz SSE poller for the
 * event loop, and a crashing job must not take the API down with it.
 *
 * The inverse also holds — realtime pollers run in `api` only, because that is
 * where the SSE connections live.
 */
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { startBoss, stopBoss } from "@/jobs/boss";
import { registerJobs } from "@/jobs/registerJobs";

async function main() {
	const boss = await startBoss();
	await registerJobs(boss);
	logger.info(`Worker (${env.NODE_ENV}) ready`);
}

let shuttingDown = false;
const shutdown = async (signal: string) => {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info({ signal }, "worker shutting down");
	try {
		await stopBoss();
	} catch (err) {
		logger.error({ err }, "error stopping pg-boss");
	}
	process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// tsx emits CJS (no "type": "module"), so no top-level await — doc 03 §A11.
main().catch((err) => {
	logger.error({ err }, "worker failed to start");
	process.exit(1);
});
