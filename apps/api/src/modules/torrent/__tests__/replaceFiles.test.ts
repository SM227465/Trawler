import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { describeWithDb } from "@/test/dbAvailable";
import { torrentRepository } from "../torrentRepository";

/**
 * The poller upserts every active torrent's files every 10 s. Rewriting rows
 * whose values had not moved put 1.19 TB of writes through a 34 MB database on
 * a 2-core box, so "unchanged means untouched" is the property under test.
 *
 * `xmin` is the transaction that wrote a row's current version: it stays put
 * only if Postgres skipped the update entirely.
 */

type FileRow = Parameters<typeof torrentRepository.replaceFiles>[1][number];

const file = (i: number, over: Partial<FileRow> = {}): FileRow => ({
	qbtIndex: i,
	path: `dir/file-${i}.mkv`,
	sizeBytes: 1000,
	progress: 0.5,
	priority: 1,
	isComplete: false,
	...over,
});

describeWithDb("torrentRepository.replaceFiles", () => {
	let userId: string;
	let torrentId: string;

	const versions = async () => {
		const { rows } = await db.execute<{ path: string; xmin: string }>(
			sql`SELECT path, xmin::text AS xmin FROM torrent_files WHERE torrent_id = ${torrentId}`,
		);
		return new Map(rows.map((r) => [r.path, r.xmin]));
	};

	beforeAll(async () => {
		userId = (
			await db.execute<{ id: string }>(sql`
				INSERT INTO users (id, email, password_hash, created_at)
				VALUES (gen_random_uuid(), ${`files-${Math.random()}@test.local`}, 'x', now())
				RETURNING id
			`)
		).rows[0].id;
		torrentId = (
			await db.execute<{ id: string }>(sql`
				INSERT INTO torrents (id, info_hash, name, size_bytes, status, added_by, added_at)
				VALUES (gen_random_uuid(), ${Math.random().toString(16).slice(2).padEnd(40, "0")},
				        'replace-files-test', 3000, 'downloading', ${userId}, now())
				RETURNING id
			`)
		).rows[0].id;
	});

	afterAll(async () => {
		// Files go with the torrent (ON DELETE CASCADE).
		await db.execute(sql`DELETE FROM torrents WHERE id = ${torrentId}`);
		await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
		await pool.end();
	});

	it("leaves unchanged rows untouched and rewrites only the one that moved", async () => {
		await torrentRepository.replaceFiles(torrentId, [file(0), file(1), file(2)]);
		const before = await versions();
		expect(before.size).toBe(3);

		await torrentRepository.replaceFiles(torrentId, [file(0), file(1), file(2)]);
		expect(await versions()).toEqual(before);

		await torrentRepository.replaceFiles(torrentId, [file(0), file(1, { progress: 1, isComplete: true }), file(2)]);
		const after = await versions();
		expect(after.get("dir/file-0.mkv")).toBe(before.get("dir/file-0.mkv"));
		expect(after.get("dir/file-1.mkv")).not.toBe(before.get("dir/file-1.mkv"));
		expect(after.get("dir/file-2.mkv")).toBe(before.get("dir/file-2.mkv"));

		const { rows } = await db.execute<{ progress: number; is_complete: boolean }>(
			sql`SELECT progress, is_complete FROM torrent_files WHERE torrent_id = ${torrentId} AND path = 'dir/file-1.mkv'`,
		);
		expect(rows[0]).toEqual({ progress: 1, is_complete: true });
	});

	it("lands a torrent with more files than one statement carries", async () => {
		const many = Array.from({ length: 2500 }, (_, i) => file(i, { path: `pack/ep-${i}.mkv` }));
		await torrentRepository.replaceFiles(torrentId, many);
		const { rows } = await db.execute<{ n: number }>(
			sql`SELECT count(*)::int AS n FROM torrent_files WHERE torrent_id = ${torrentId} AND path LIKE 'pack/%'`,
		);
		expect(rows[0].n).toBe(2500);
	});
});
