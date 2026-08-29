import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { uploads } from "@/db/schema";

type UploadRow = typeof uploads.$inferSelect;

export const uploadRepository = {
	create(row: typeof uploads.$inferInsert) {
		return db.insert(uploads).values(row).returning();
	},

	byId(id: string) {
		return db.query.uploads.findFirst({ where: eq(uploads.id, id) });
	},

	recent(limit = 50): Promise<UploadRow[]> {
		return db
			.select()
			.from(uploads)
			.orderBy(desc(uploads.createdAt))
			.limit(Math.min(Math.max(limit, 1), 200));
	},

	/** Everything still in flight, for progress polling and reconciliation. */
	active(): Promise<UploadRow[]> {
		return db
			.select()
			.from(uploads)
			.where(inArray(uploads.status, ["queued", "running"]));
	},

	update(id: string, patch: Partial<typeof uploads.$inferInsert>) {
		return db.update(uploads).set(patch).where(eq(uploads.id, id)).returning();
	},

	/**
	 * Claims a queued row for starting, atomically.
	 *
	 * The status check is in the WHERE, not read-then-write: pg-boss can deliver
	 * the same job twice after a worker dies mid-handler, and two rclone copies
	 * of one folder is exactly the thing the partial unique index exists to stop.
	 */
	async claim(id: string): Promise<UploadRow | null> {
		const [row] = await db
			.update(uploads)
			.set({ status: "running", startedAt: new Date() })
			.where(and(eq(uploads.id, id), eq(uploads.status, "queued")))
			.returning();
		return row ?? null;
	},

	/**
	 * The most recent upload of a path to a remote, whatever its state.
	 *
	 * Cleanup asks this before deleting anything: only a `completed` row is
	 * permission to remove the local copy.
	 */
	async latestFor(remoteName: string, srcPath: string): Promise<UploadRow | null> {
		const [row] = await db
			.select()
			.from(uploads)
			.where(and(eq(uploads.remoteName, remoteName), eq(uploads.srcPath, srcPath)))
			.orderBy(desc(uploads.createdAt))
			.limit(1);
		return row ?? null;
	},

	/** Removes finished rows; the live ones are never touched. */
	async clearFinished(): Promise<number> {
		const res = await db.delete(uploads).where(sql`status in ('completed','failed','cancelled')`);
		return res.rowCount ?? 0;
	},
};
