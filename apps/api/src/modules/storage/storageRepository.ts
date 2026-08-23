import { sql } from "drizzle-orm";
import { type Db, db } from "@/db/client";

/** Anything that can run SQL — the pool, or a transaction handle in tests. */
type Executor = Pick<Db, "execute">;

export interface EvictionCandidate extends Record<string, unknown> {
	id: string;
	infoHash: string;
	sizeBytes: number;
	name: string;
}

export class StorageRepository {
	/**
	 * Doc 02 §4 — the one query worth writing by hand.
	 *
	 * `NOT EXISTS` rather than a partial index: a share's active-ness depends on
	 * now(), which is not immutable and therefore cannot appear in an index
	 * predicate.
	 *
	 * Three things this must NEVER return, in priority order:
	 *   1. a pinned torrent
	 *   2. a torrent with an active share (directly, or on any of its files)
	 *   3. an incomplete torrent (nothing to reclaim; deleting loses progress)
	 */
	async evictionCandidates(
		opts: { ttlHours: number; overHighWatermark: boolean; limit?: number },
		/** Injected in tests so the whole matrix runs inside a rolled-back transaction. */
		exec: Executor = db,
	) {
		const { rows } = await exec.execute<EvictionCandidate>(sql`
			SELECT t.id, t.info_hash AS "infoHash", t.size_bytes AS "sizeBytes", t.name
			FROM torrents t
			WHERE t.status = 'completed'
			  AND t.pinned = false
			  AND (
			        t.completed_at < now() - (${String(opts.ttlHours)} || ' hours')::interval
			     OR ${opts.overHighWatermark}::boolean
			  )
			  AND NOT EXISTS (
			        SELECT 1 FROM shares s
			        WHERE (s.torrent_id = t.id OR s.file_id IN (
			                 SELECT f.id FROM torrent_files f WHERE f.torrent_id = t.id))
			          AND s.revoked_at IS NULL
			          AND (s.expires_at IS NULL OR s.expires_at > now())
			      )
			ORDER BY t.last_accessed_at ASC NULLS FIRST
			LIMIT ${opts.limit ?? 50}
		`);

		// node-postgres returns bigint as a STRING to avoid precision loss, and
		// db.execute() bypasses Drizzle's `mode: "number"` column mapping. Without
		// this coercion `freed += sizeBytes` silently becomes string concatenation
		// ("0" + "276445467" = "0276445467") and every byte comparison downstream
		// is nonsense.
		return rows.map((r) => ({ ...r, sizeBytes: Number(r.sizeBytes) }));
	}

	/** Total bytes the torrent library currently occupies. */
	async torrentsTotalBytes(exec: Executor = db): Promise<number> {
		const { rows } = await exec.execute<{ total: string } & Record<string, unknown>>(
			sql`SELECT COALESCE(SUM(size_bytes), 0)::text AS total FROM torrents`,
		);
		return Number(rows[0]?.total ?? 0);
	}

	/**
	 * One handler at a time, cluster-wide. Session-scoped, so it is released if
	 * the worker dies mid-run rather than wedging eviction forever.
	 */
	async tryLock(key: number): Promise<boolean> {
		const { rows } = await db.execute<{ locked: boolean } & Record<string, unknown>>(
			sql`SELECT pg_try_advisory_lock(${key}) AS locked`,
		);
		return rows[0]?.locked === true;
	}

	async unlock(key: number) {
		await db.execute(sql`SELECT pg_advisory_unlock(${key})`);
	}
}

export const storageRepository = new StorageRepository();
