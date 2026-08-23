import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { storageRepository } from "../storageRepository";

/**
 * Doc 03 §A10 lists this as non-negotiable: the eviction candidate query MUST
 * NEVER return a shared or pinned torrent. A bug here silently deletes files
 * someone is actively sharing.
 *
 * Every case runs inside a transaction that is always rolled back, so this hits
 * real Postgres — real interval maths, real NULLS FIRST ordering, real NOT
 * EXISTS semantics — without a separate test database and without touching dev
 * data. Mocking the DB here would test nothing that matters.
 */

const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

interface TorrentFixture {
	name: string;
	pinned?: boolean;
	status?: "completed" | "downloading";
	completedAt?: Date | null;
	lastAccessedAt?: Date | null;
}

/**
 * Seeds an isolated world, runs the query, rolls back. Returns the candidate
 * names so assertions read as intent rather than uuid soup.
 */
async function withFixtures(
	build: (t: {
		torrent: (f: TorrentFixture) => Promise<string>;
		file: (torrentId: string, path: string) => Promise<string>;
		share: (o: {
			torrentId?: string;
			fileId?: string;
			expiresAt?: Date | null;
			revokedAt?: Date | null;
		}) => Promise<void>;
	}) => Promise<void>,
	opts: { ttlHours?: number; overHighWatermark?: boolean } = {},
): Promise<string[]> {
	let names: string[] = [];

	await db
		.transaction(async (tx) => {
			const [{ id: userId }] = (
				await tx.execute<{ id: string }>(sql`
					INSERT INTO users (id, email, password_hash, created_at)
					VALUES (gen_random_uuid(), ${`evict-${Math.random()}@test.local`}, 'x', now())
					RETURNING id
				`)
			).rows;

			// Every fixture torrent is tagged so we never pick up dev-data rows.
			const marker = `evict-test-${Math.random().toString(36).slice(2)}`;

			const helpers = {
				async torrent(f: TorrentFixture) {
					const { rows } = await tx.execute<{ id: string }>(sql`
						INSERT INTO torrents (id, info_hash, name, size_bytes, status, pinned,
						                      completed_at, last_accessed_at, added_by, added_at)
						VALUES (gen_random_uuid(),
						        ${Math.random().toString(16).slice(2).padEnd(40, "0")},
						        ${`${marker}:${f.name}`},
						        1000,
						        ${f.status ?? "completed"},
						        ${f.pinned ?? false},
						        ${f.completedAt === undefined ? ago(100 * HOUR) : f.completedAt},
						        ${f.lastAccessedAt ?? null},
						        ${userId}, now())
						RETURNING id
					`);
					return rows[0].id;
				},
				async file(torrentId: string, path: string) {
					const { rows } = await tx.execute<{ id: string }>(sql`
						INSERT INTO torrent_files (id, torrent_id, qbt_index, path, size_bytes, is_complete)
						VALUES (gen_random_uuid(), ${torrentId}, 0, ${path}, 100, true)
						RETURNING id
					`);
					return rows[0].id;
				},
				async share(o: { torrentId?: string; fileId?: string; expiresAt?: Date | null; revokedAt?: Date | null }) {
					await tx.execute(sql`
						INSERT INTO shares (id, scope, torrent_id, file_id, created_by, expires_at, revoked_at, created_at)
						VALUES (${Math.random().toString(36).slice(2, 18)},
						        ${o.fileId ? "file" : "torrent"},
						        ${o.torrentId ?? null}, ${o.fileId ?? null}, ${userId},
						        ${o.expiresAt ?? null}, ${o.revokedAt ?? null}, now())
					`);
				},
			};

			await build(helpers);

			const rows = await storageRepository.evictionCandidates(
				{ ttlHours: opts.ttlHours ?? 48, overHighWatermark: opts.overHighWatermark ?? false, limit: 100 },
				tx,
			);
			names = rows.filter((r) => r.name.startsWith(marker)).map((r) => r.name.split(":")[1]);

			// Always roll back — nothing above is ever committed.
			throw new Error("__rollback__");
		})
		.catch((err) => {
			if ((err as Error).message !== "__rollback__") throw err;
		});

	return names;
}

afterAll(async () => {
	await pool.end();
});

describe("eviction candidates — what must NEVER be returned", () => {
	it("never returns a pinned torrent, even long past its TTL", async () => {
		const names = await withFixtures(async (t) => {
			await t.torrent({ name: "pinned", pinned: true });
			await t.torrent({ name: "evictable" });
		});
		expect(names).toContain("evictable");
		expect(names).not.toContain("pinned");
	});

	it("never returns a torrent with an active TORRENT-scoped share", async () => {
		const names = await withFixtures(async (t) => {
			const shared = await t.torrent({ name: "shared" });
			await t.share({ torrentId: shared });
			await t.torrent({ name: "evictable" });
		});
		expect(names).toContain("evictable");
		expect(names).not.toContain("shared");
	});

	it("never returns a torrent when the share targets one of its FILES", async () => {
		// The subquery branch that is easy to get wrong.
		const names = await withFixtures(async (t) => {
			const parent = await t.torrent({ name: "file-shared" });
			const fileId = await t.file(parent, "inner/movie.mkv");
			await t.share({ fileId });
			await t.torrent({ name: "evictable" });
		});
		expect(names).toContain("evictable");
		expect(names).not.toContain("file-shared");
	});

	it("never returns an incomplete torrent", async () => {
		const names = await withFixtures(async (t) => {
			await t.torrent({ name: "downloading", status: "downloading", completedAt: null });
			await t.torrent({ name: "evictable" });
		});
		expect(names).toEqual(["evictable"]);
	});

	it("never returns a torrent whose share expires in the future", async () => {
		const names = await withFixtures(async (t) => {
			const s = await t.torrent({ name: "share-still-live" });
			await t.share({ torrentId: s, expiresAt: ahead(24 * HOUR) });
			await t.torrent({ name: "evictable" });
		});
		expect(names).not.toContain("share-still-live");
	});
});

describe("eviction candidates — what SHOULD be returned", () => {
	it("returns a torrent whose share was revoked", async () => {
		const names = await withFixtures(async (t) => {
			const s = await t.torrent({ name: "revoked-share" });
			await t.share({ torrentId: s, revokedAt: ago(HOUR) });
		});
		expect(names).toContain("revoked-share");
	});

	it("returns a torrent whose share has expired", async () => {
		const names = await withFixtures(async (t) => {
			const s = await t.torrent({ name: "expired-share" });
			await t.share({ torrentId: s, expiresAt: ago(HOUR) });
		});
		expect(names).toContain("expired-share");
	});

	it("a revoked share does NOT protect, even with a future expiry", async () => {
		const names = await withFixtures(async (t) => {
			const s = await t.torrent({ name: "revoked-but-unexpired" });
			await t.share({ torrentId: s, expiresAt: ahead(24 * HOUR), revokedAt: ago(HOUR) });
		});
		expect(names).toContain("revoked-but-unexpired");
	});
});

describe("eviction triggers", () => {
	it("leaves a recently completed torrent alone when under the watermark", async () => {
		const names = await withFixtures(
			async (t) => {
				await t.torrent({ name: "fresh", completedAt: ago(1 * HOUR) });
				await t.torrent({ name: "stale", completedAt: ago(100 * HOUR) });
			},
			{ ttlHours: 48 },
		);
		expect(names).toContain("stale");
		expect(names).not.toContain("fresh");
	});

	it("disk pressure overrides the TTL entirely", async () => {
		const names = await withFixtures(
			async (t) => {
				await t.torrent({ name: "fresh", completedAt: ago(1 * HOUR) });
			},
			{ ttlHours: 48, overHighWatermark: true },
		);
		expect(names).toContain("fresh");
	});

	it("but pressure still does not override a pin or an active share", async () => {
		const names = await withFixtures(
			async (t) => {
				await t.torrent({ name: "pinned", pinned: true, completedAt: ago(1 * HOUR) });
				const s = await t.torrent({ name: "shared", completedAt: ago(1 * HOUR) });
				await t.share({ torrentId: s });
				await t.torrent({ name: "evictable", completedAt: ago(1 * HOUR) });
			},
			{ overHighWatermark: true },
		);
		expect(names).toEqual(["evictable"]);
	});

	it("orders least-recently-accessed first, never-accessed before all", async () => {
		const names = await withFixtures(async (t) => {
			await t.torrent({ name: "recent", lastAccessedAt: ago(1 * HOUR) });
			await t.torrent({ name: "old", lastAccessedAt: ago(500 * HOUR) });
			await t.torrent({ name: "never", lastAccessedAt: null });
		});
		expect(names).toEqual(["never", "old", "recent"]);
	});
});

describe("result typing", () => {
	it("returns sizeBytes as a NUMBER, not a bigint string", async () => {
		// Regression: db.execute() bypasses Drizzle's mode:"number" mapping, so
		// bigint arrives as a string and `freed += sizeBytes` concatenates.
		let sizes: unknown[] = [];
		await db
			.transaction(async (tx) => {
				const [{ id: userId }] = (
					await tx.execute<{ id: string }>(sql`
						INSERT INTO users (id, email, password_hash, created_at)
						VALUES (gen_random_uuid(), ${`size-${Math.random()}@test.local`}, 'x', now())
						RETURNING id
					`)
				).rows;
				await tx.execute(sql`
					INSERT INTO torrents (id, info_hash, name, size_bytes, status, pinned, completed_at, added_by, added_at)
					VALUES (gen_random_uuid(), ${Math.random().toString(16).slice(2).padEnd(40, "0")},
					        'size-check', 276445467, 'completed', false, now() - interval '100 hours', ${userId}, now())
				`);
				const rows = await storageRepository.evictionCandidates(
					{ ttlHours: 48, overHighWatermark: false, limit: 100 },
					tx,
				);
				sizes = rows.map((r) => r.sizeBytes);
				throw new Error("__rollback__");
			})
			.catch((e) => {
				if ((e as Error).message !== "__rollback__") throw e;
			});

		expect(sizes.length).toBeGreaterThan(0);
		for (const s of sizes) expect(typeof s).toBe("number");
		// The actual failure mode: string + string.
		expect(sizes.reduce((a: number, b) => a + (b as number), 0)).toBeTypeOf("number");
	});
});
