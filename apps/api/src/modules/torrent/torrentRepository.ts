import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/db/client";
import { torrentFiles, torrents } from "@/db/schema";

type TorrentInsert = typeof torrents.$inferInsert;
type TorrentUpdate = Partial<TorrentInsert>;

export class TorrentRepository {
	findById(id: string) {
		return db.query.torrents.findFirst({ where: eq(torrents.id, id) });
	}

	findByInfoHash(infoHash: string) {
		return db.query.torrents.findFirst({ where: eq(torrents.infoHash, infoHash) });
	}

	async list(opts: { status?: string; q?: string; limit: number; offset: number }) {
		const filters = [];
		if (opts.status) filters.push(eq(torrents.status, opts.status as never));
		if (opts.q) filters.push(ilike(torrents.name, `%${opts.q}%`));
		const where = filters.length ? and(...filters) : undefined;

		const [rows, [{ count }]] = await Promise.all([
			db.select().from(torrents).where(where).orderBy(desc(torrents.addedAt)).limit(opts.limit).offset(opts.offset),
			db.select({ count: sql<number>`count(*)::int` }).from(torrents).where(where),
		]);
		return { rows, total: count };
	}

	async create(input: Omit<TorrentInsert, "id">) {
		const [row] = await db
			.insert(torrents)
			.values({ id: uuidv7(), ...input })
			.returning();
		return row;
	}

	async update(id: string, patch: TorrentUpdate) {
		const [row] = await db.update(torrents).set(patch).where(eq(torrents.id, id)).returning();
		return row;
	}

	/** Bulk upsert from the poller. Keyed on info_hash, which is unique. */
	async upsertFromSync(rows: TorrentInsert[]) {
		if (rows.length === 0) return;
		for (const row of rows) {
			const { id: _ignored, addedBy: _addedBy, infoHash, ...patch } = row;
			await db.update(torrents).set(patch).where(eq(torrents.infoHash, infoHash));
		}
	}

	delete(id: string) {
		return db.delete(torrents).where(eq(torrents.id, id));
	}

	touch(id: string) {
		return db.update(torrents).set({ lastAccessedAt: new Date() }).where(eq(torrents.id, id));
	}

	filesFor(torrentId: string) {
		return db.query.torrentFiles.findMany({ where: eq(torrentFiles.torrentId, torrentId) });
	}

	async replaceFiles(torrentId: string, rows: Omit<typeof torrentFiles.$inferInsert, "id" | "torrentId">[]) {
		for (const row of rows) {
			await db
				.insert(torrentFiles)
				.values({ id: uuidv7(), torrentId, ...row })
				.onConflictDoUpdate({
					target: [torrentFiles.torrentId, torrentFiles.path],
					set: {
						progress: row.progress,
						priority: row.priority,
						isComplete: row.isComplete,
						sizeBytes: row.sizeBytes,
						qbtIndex: row.qbtIndex,
					},
				});
		}
	}
}

export const torrentRepository = new TorrentRepository();
