/**
 * Manual job trigger — `pnpm job:send storage.evict`.
 * Useful for testing a handler without waiting out its cron, and for the
 * "run now" button the settings UI will want.
 */
import { logger } from "@/common/utils/logger";
import { startBoss, stopBoss } from "./boss";
import { JOB, type JobName } from "./jobNames";

async function main() {
	const name = process.argv[2] as JobName | undefined;
	const valid = Object.values(JOB) as string[];

	if (!name || !valid.includes(name)) {
		console.error(`usage: pnpm job:send <${valid.join(" | ")}>`);
		process.exit(1);
	}

	const boss = await startBoss();
	const id = await boss.send(name, {});
	logger.info({ job: name, id }, id ? "job queued" : "job not queued (queue missing?)");
	await stopBoss();
}

main().catch((err) => {
	logger.error({ err }, "failed to send job");
	process.exit(1);
});
