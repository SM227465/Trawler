import { v7 as uuidv7 } from "uuid";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { hashPassword } from "@/modules/auth/authService";
import { db, pool } from "./client";
import { appSettings, users } from "./schema";

async function main() {
	const email = env.OWNER_EMAIL.toLowerCase();

	const existing = await db.query.users.findFirst();
	if (existing) {
		logger.info({ email: existing.email }, "owner already seeded — skipping");
	} else {
		await db.insert(users).values({
			id: uuidv7(),
			email,
			passwordHash: await hashPassword(env.OWNER_PASSWORD),
		});
		logger.info({ email }, "owner user created");
	}

	const defaults: Record<string, unknown> = {
		"eviction.enabled": false,
		"eviction.budgetBytes": 0,
		"eviction.ttlHours": env.EVICTION_TTL_HOURS,
		"eviction.highWatermarkPct": env.EVICTION_HIGH_WATERMARK_PCT,
		"eviction.lowWatermarkPct": env.EVICTION_LOW_WATERMARK_PCT,
		"share.defaultTtlHours": 168,
		"share.defaultMaxBytesMultiplier": 5,
		"egress.softAlertBytes": env.EGRESS_SOFT_ALERT_BYTES,
		"egress.hardStopBytes": env.EGRESS_HARD_STOP_BYTES,
		"media.maxConcurrentRemux": 2,
	};

	for (const [key, value] of Object.entries(defaults)) {
		await db.insert(appSettings).values({ key, value }).onConflictDoNothing();
	}
	logger.info({ count: Object.keys(defaults).length }, "app_settings seeded");

	await pool.end();
}

main().catch((err) => {
	logger.error({ err }, "seed failed");
	process.exit(1);
});
