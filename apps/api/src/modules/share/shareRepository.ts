import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
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
}

export const shareRepository = new ShareRepository();
