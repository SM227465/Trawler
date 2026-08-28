import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

export const OFFSET_KEY = "egress.logOffset";
/** Last `alltime_ul` seen from qBittorrent, so we can bank the delta. */
export const TORRENT_UL_SEEN_KEY = "egress.torrentUlSeen";
/** Month bucket for seeded bytes: `egress.torrentUl.2026-08`. */
export const torrentUlKey = (month: string) => `egress.torrentUl.${month}`;

export const currentMonth = () => new Date().toISOString().slice(0, 7);

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

	/** Generic counter helpers over app_settings, same pattern as the offset. */
	private async getNumber(key: string): Promise<number> {
		const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
		const n = Number(row?.value ?? 0);
		return Number.isFinite(n) && n >= 0 ? n : 0;
	}

	private async setNumber(key: string, value: number) {
		await db
			.insert(appSettings)
			.values({ key, value })
			.onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
	}

	/**
	 * Banks the growth in qBittorrent's all-time upload counter into this
	 * month's bucket.
	 *
	 * Deltas, not absolutes: the counter is cumulative across the qBittorrent
	 * install, so only the increase since the last poll belongs to this month.
	 * A value LOWER than last seen means the counter reset — qBittorrent was
	 * reinstalled or its stats cleared — and the safe reading is to bank the new
	 * value as-is and carry on rather than record a negative.
	 */
	async bankTorrentUpload(alltimeUl: number): Promise<number> {
		const seen = await this.getNumber(TORRENT_UL_SEEN_KEY);
		const delta = alltimeUl >= seen ? alltimeUl - seen : alltimeUl;
		await this.setNumber(TORRENT_UL_SEEN_KEY, alltimeUl);
		if (delta <= 0) return 0;

		const key = torrentUlKey(currentMonth());
		await this.setNumber(key, (await this.getNumber(key)) + delta);
		return delta;
	}

	async monthToDateTorrentBytes(): Promise<number> {
		return this.getNumber(torrentUlKey(currentMonth()));
	}
}

export const egressRepository = new EgressRepository();
