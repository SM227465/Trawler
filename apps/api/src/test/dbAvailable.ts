import { sql } from "drizzle-orm";
import { describe } from "vitest";
import { db } from "@/db/client";

/**
 * Some suites need a REAL Postgres — the eviction query and the egress upsert
 * depend on interval arithmetic, NULLS FIRST ordering and ON CONFLICT against
 * an expression index, none of which a mock reproduces.
 *
 * On a fresh clone there may be no database at all. Those suites SKIP with a
 * visible reason rather than failing with a connection error, so `pnpm test`
 * is useful immediately and the failures that remain are real ones. CI always
 * provides Postgres, so nothing is skipped there.
 */
let cached: boolean | null = null;

export async function isDatabaseReachable(): Promise<boolean> {
	if (cached !== null) return cached;
	try {
		await db.execute(sql`select 1`);
		cached = true;
	} catch {
		cached = false;
	}
	return cached;
}

/**
 * `describe` that skips the whole suite when no database is reachable.
 * Vitest needs the skip decision synchronously, so availability is probed once
 * at module load.
 */
export const describeWithDb: typeof describe.skip = (await isDatabaseReachable()) ? describe : describe.skip;
