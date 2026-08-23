import { sql } from "drizzle-orm";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";

/**
 * Nightly table maintenance. Everything here is append-only and unbounded, so
 * without this the box slowly fills with history nobody reads.
 *
 * `egress_daily` is deliberately NOT pruned here: it is one row per day per
 * share, it is what the monthly allowance is computed from, and losing it would
 * make the guard under-count.
 */

const SHARE_LOG_DAYS = 30;
const AUDIT_LOG_DAYS = 30;
const EXPIRED_TOKEN_DAYS = 7;

export async function pruneHandler() {
	const results: Record<string, number> = {};

	try {
		const { rowCount } = await db.execute(
			sql`DELETE FROM share_access_log WHERE at < now() - ${`${SHARE_LOG_DAYS} days`}::interval`,
		);
		results.shareAccessLog = rowCount ?? 0;
	} catch (err) {
		logger.error({ err }, "pruning share_access_log failed");
	}

	try {
		// Same 30-day window as share_access_log. This is log rotation, not the
		// app deleting user data on its own — audit rows describe actions, and
		// the files and torrents they refer to are untouched.
		const { rowCount } = await db.execute(
			sql`DELETE FROM audit_log WHERE at < now() - ${`${AUDIT_LOG_DAYS} days`}::interval`,
		);
		results.auditLog = rowCount ?? 0;
	} catch (err) {
		logger.error({ err }, "pruning audit_log failed");
	}

	try {
		// Refresh tokens are already single-use; these are the spent and expired
		// rows kept only long enough to detect reuse.
		const { rowCount } = await db.execute(
			sql`DELETE FROM refresh_tokens
			    WHERE expires_at < now() - ${`${EXPIRED_TOKEN_DAYS} days`}::interval`,
		);
		results.refreshTokens = rowCount ?? 0;
	} catch (err) {
		logger.error({ err }, "pruning refresh_tokens failed");
	}

	logger.info(results, "log prune complete");
	return results;
}
