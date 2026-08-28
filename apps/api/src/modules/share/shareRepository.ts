import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";
import { shareAccessLog, shares, torrentFiles, torrents } from "@/db/schema";

type ShareInsert = typeof shares.$inferInsert;

export class ShareRepository {
	create(row: ShareInsert) {
		return db
			.insert(shares)
			.values(row)
			.returning()
			.then((r) => r[0]);
	}

	findById(id: string) {
		return db.query.shares.findFirst({ where: eq(shares.id, id) });
	}

	/** Share plus what it points at — the public page needs both in one round trip. */
	async findWithTarget(id: string) {
		const [row] = await db
			.select({
				share: shares,
				file: torrentFiles,
				torrent: torrents,
			})
			.from(shares)
			.leftJoin(torrentFiles, eq(shares.fileId, torrentFiles.id))
			.leftJoin(
				torrents,
				// A share targets EITHER a file (join through it) or a torrent.
				or(eq(shares.torrentId, torrents.id), eq(torrentFiles.torrentId, torrents.id)),
			)
			.where(eq(shares.id, id))
			.limit(1);
		return row ?? null;
	}

	listByOwner(userId: string) {
		return db.select().from(shares).where(eq(shares.createdBy, userId)).orderBy(desc(shares.createdAt));
	}

	revoke(id: string, userId: string) {
		return db
			.update(shares)
			.set({ revokedAt: new Date() })
			.where(and(eq(shares.id, id), eq(shares.createdBy, userId), isNull(shares.revokedAt)))
			.returning();
	}

	/**
	 * Byte accounting. Incremented in SQL rather than read-modify-write so two
	 * concurrent downloads cannot both read the old total and lose one increment.
	 */
	recordServed(id: string, bytes: number) {
		return db
			.update(shares)
			.set({
				bytesServed: sql`${shares.bytesServed} + ${bytes}`,
				requestCount: sql`${shares.requestCount} + 1`,
				lastAccessedAt: new Date(),
			})
			.where(eq(shares.id, id));
	}

	logAccess(row: typeof shareAccessLog.$inferInsert) {
		return db.insert(shareAccessLog).values(row);
	}

	/**
	 * Deletes every share that can no longer serve anything: revoked, past its
	 * expiry, or over its byte cap.
	 *
	 * The predicate is shareState() expressed in SQL. It lives in two places now,
	 * which is a real cost — but the alternative is loading every share to filter
	 * in JS, and this one is a bulk delete where that would be silly. If
	 * shareState gains a condition, this needs the same one.
	 *
	 * share_access_log rows cascade with the share, so this also drops their
	 * history. That is stated plainly in the confirm dialog.
	 */
	async deleteInactive(userId: string): Promise<number> {
		const res = await db
			.delete(shares)
			.where(
				and(
					eq(shares.createdBy, userId),
					or(
						sql`${shares.revokedAt} is not null`,
						sql`${shares.expiresAt} is not null and ${shares.expiresAt} <= now()`,
						sql`${shares.maxBytes} is not null and ${shares.bytesServed} >= ${shares.maxBytes}`,
					),
				),
			);
		return res.rowCount ?? 0;
	}

	/**
	 * Fire-and-forget access logging. Never awaited and never throws: a share
	 * must be served, or refused, on its own merits — a failing log table is not
	 * a reason to change either answer.
	 */
	logAccessSafe(row: typeof shareAccessLog.$inferInsert) {
		void this.logAccess(row).catch((err) =>
			logger.error({ err, shareId: row.shareId, kind: row.kind }, "share access log failed"),
		);
	}

	/** Recent accesses for one share, newest first. */
	accessLog(shareId: string, limit = 100) {
		return db
			.select({
				id: shareAccessLog.id,
				kind: shareAccessLog.kind,
				status: shareAccessLog.status,
				reason: shareAccessLog.reason,
				ip: shareAccessLog.ip,
				userAgent: shareAccessLog.userAgent,
				bytes: shareAccessLog.bytes,
				at: shareAccessLog.at,
			})
			.from(shareAccessLog)
			.where(eq(shareAccessLog.shareId, shareId))
			.orderBy(desc(shareAccessLog.at), desc(shareAccessLog.id))
			.limit(Math.min(Math.max(limit, 1), 500));
	}

	/**
	 * Counts per kind plus distinct source addresses.
	 *
	 * The visitor count is the number that changes how you read the rest: five
	 * downloads from one address is you testing the link, five from five
	 * addresses is the link circulating.
	 */
	async accessSummary(shareId: string) {
		const [row] = await db
			.select({
				views: sql<number>`count(*) filter (where ${shareAccessLog.kind} = 'view')::int`,
				downloads: sql<number>`count(*) filter (where ${shareAccessLog.kind} = 'download')::int`,
				denied: sql<number>`count(*) filter (where ${shareAccessLog.kind} = 'denied')::int`,
				unlockFailed: sql<number>`count(*) filter (where ${shareAccessLog.kind} = 'unlock_failed')::int`,
				visitors: sql<number>`count(distinct ${shareAccessLog.ip})::int`,
				lastAt: sql<Date | null>`max(${shareAccessLog.at})`,
			})
			.from(shareAccessLog)
			.where(eq(shareAccessLog.shareId, shareId));

		return row ?? { views: 0, downloads: 0, denied: 0, unlockFailed: 0, visitors: 0, lastAt: null };
	}
}

export const shareRepository = new ShareRepository();
