import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { torrentFiles, torrents } from "@/db/schema";

export class FileRepository {
	/**
	 * A file plus the torrent it belongs to. An explicit join rather than
	 * Drizzle's `with:` — no `relations()` are declared in schema.ts, and one
	 * join here is cheaper than introducing a relations layer for a single call.
	 */
	async findWithTorrent(fileId: string) {
		const [row] = await db
			.select({
				file: torrentFiles,
				torrentName: torrents.name,
				torrentStatus: torrents.status,
			})
			.from(torrentFiles)
			.innerJoin(torrents, eq(torrentFiles.torrentId, torrents.id))
			.where(eq(torrentFiles.id, fileId))
			.limit(1);
		return row ?? null;
	}

	findById(fileId: string) {
		return db.query.torrentFiles.findFirst({ where: eq(torrentFiles.id, fileId) });
	}

	listByTorrent(torrentId: string) {
		return db.query.torrentFiles.findMany({ where: eq(torrentFiles.torrentId, torrentId) });
	}

	/** Eviction ranks by least-recently-used, so every link issued counts as a touch. */
	touchTorrent(torrentId: string) {
		return db.update(torrents).set({ lastAccessedAt: new Date() }).where(eq(torrents.id, torrentId));
	}

	setPriority(fileId: string, priority: number) {
		return db.update(torrentFiles).set({ priority }).where(eq(torrentFiles.id, fileId)).returning();
	}

	/**
	 * Maps on-disk paths to file ids, for the browser's Share action.
	 *
	 * `torrent_files.path` is relative to the downloads root — the same
	 * coordinate space browse entries use, which is why getDownloadLink can hand
	 * it straight to resolveDownloadPath. One query for the whole page rather
	 * than one per row.
	 *
	 * Only complete files: a share pointing at a half-written file would serve a
	 * silently truncated download to whoever you sent the link to.
	 */
	async idsByPaths(paths: string[]): Promise<Map<string, string>> {
		if (paths.length === 0) return new Map();
		const rows = await db
			.select({ id: torrentFiles.id, path: torrentFiles.path })
			.from(torrentFiles)
			.where(and(inArray(torrentFiles.path, paths), eq(torrentFiles.isComplete, true)));
		return new Map(rows.map((r) => [r.path, r.id]));
	}
}

export const fileRepository = new FileRepository();
