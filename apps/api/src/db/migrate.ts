import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "@/common/utils/logger";
import { db, pool } from "./client";

// No top-level await: package.json has no "type": "module", so tsx emits CJS.
async function main() {
	await migrate(db, { migrationsFolder: "./src/db/migrations" });
	logger.info("migrations applied");
	await pool.end();
}

main().catch((err) => {
	logger.error({ err }, "migration failed");
	process.exit(1);
});
