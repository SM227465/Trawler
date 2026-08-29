import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { mediaProbes, torrentFiles, torrents } from "@/db/schema";

export const mediaRepository = {
	byFileId(fileId: string) {
		return db.query.mediaProbes.findFirst({ where: eq(mediaProbes.fileId, fileId) });
	},

	/**
	 * Completed files that have never been probed.
	 *
	 * Only complete ones: probing a half-written file reads whatever headers
	 * happen to be there and caches a wrong answer, and the row is keyed by file
	 * so nothing would ever correct it.
	 */
	async unprobed(limit = 20) {
		const { rows } = await db.execute<{ id: string; path: string; name: string }>(sql`
			SELECT f.id, f.path, t.name
			FROM torrent_files f
			JOIN torrents t ON t.id = f.torrent_id
			LEFT JOIN media_probes p ON p.file_id = f.id
			WHERE f.is_complete = true
			  AND p.file_id IS NULL
			ORDER BY f.size_bytes DESC
			LIMIT ${limit}
		`);
		return rows;
	},

	upsert(row: typeof mediaProbes.$inferInsert) {
		return db
			.insert(mediaProbes)
			.values(row)
			.onConflictDoUpdate({ target: mediaProbes.fileId, set: { ...row, probedAt: new Date() } });
	},

	/** Playback verdicts for a set of files, for the browser to act on. */
	async playbackFor(fileIds: string[]) {
		if (fileIds.length === 0) return new Map<string, typeof mediaProbes.$inferSelect>();
		const rows = await db
			.select()
			.from(mediaProbes)
			.where(sql`${mediaProbes.fileId} = ANY(${sql.raw(`ARRAY['${fileIds.join("','")}']::uuid[]`)})`);
		return new Map(rows.map((r) => [r.fileId, r]));
	},
};

export { and, eq, isNull, torrentFiles, torrents };
