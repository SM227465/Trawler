import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

export const OFFSET_KEY = "egress.logOffset";

export class EgressRepository {
	/** Byte offset into the access log, so a restart does not re-count. */
	async getOffset(): Promise<number> {
		const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, OFFSET_KEY) });
		const n = Number(row?.value ?? 0);
		return Number.isFinite(n) && n >= 0 ? n : 0;
	}

	async setOffset(offset: number) {
		await db
			.insert(appSettings)
			.values({ key: OFFSET_KEY, value: offset })
			.onConflictDoUpdate({ target: appSettings.key, set: { value: offset, updatedAt: new Date() } });
	}

	/**
	 * Adds to a (day, share) bucket.
	 *
	 * Raw SQL because the conflict target is an EXPRESSION index — `COALESCE(
	 * share_id, '')` — which the query builder cannot express. The expression is
	 * required at all because NULL != NULL in Postgres: a plain unique index on
	 * (day, share_id) would never match the owner-download row, and every batch
	 * would insert a duplicate instead of accumulating.
	 */
	async addBytes(day: string, shareId: string | null, bytes: number) {
		if (bytes <= 0) return;

		await db.execute(sql`
			INSERT INTO egress_daily (day, share_id, bytes_served)
			VALUES (${day}, ${shareId}, ${bytes})
			ON CONFLICT (day, COALESCE(share_id, ''))
			DO UPDATE SET bytes_served = egress_daily.bytes_served + ${bytes}
		`);
	}

	/** Month-to-date total across every share and owner download. */
	async monthToDateBytes(): Promise<number> {
		const first = new Date();
		first.setUTCDate(1);
		const day = first.toISOString().slice(0, 10);

		const { rows } = await db.execute<{ total: string } & Record<string, unknown>>(
			sql`SELECT COALESCE(SUM(bytes_served), 0)::text AS total FROM egress_daily WHERE day >= ${day}`,
		);
		return Number(rows[0]?.total ?? 0);
	}

	async recentDays(days = 30) {
		const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
		const { rows } = await db.execute<{ day: string; total: string } & Record<string, unknown>>(
			sql`SELECT day::text AS day, SUM(bytes_served)::text AS total
			    FROM egress_daily WHERE day >= ${since}
			    GROUP BY day ORDER BY day`,
		);
		return rows.map((r) => ({ day: r.day, bytes: Number(r.total) }));
	}
}

export const egressRepository = new EgressRepository();
