import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

/**
 * App-level metadata about a remote: which bucket, which prefix, which preset
 * it was created from.
 *
 * In app_settings rather than its own table because none of it is a secret and
 * none of it is queried — it is read whole, per remote, to render a form. The
 * credentials live in rclone's config and the remote itself is rclone's record;
 * a table here would be a second source of truth for something rclone already
 * owns.
 */
const key = (name: string) => `remote.${name}`;

export interface RemoteMeta {
	kind: string;
	/** Empty for OAuth providers — the account itself is the root. */
	bucket: string;
	prefix: string;
}

export const remoteRepository = {
	async get(name: string): Promise<RemoteMeta | null> {
		const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key(name)) });
		return (row?.value as RemoteMeta | undefined) ?? null;
	},

	async set(name: string, meta: RemoteMeta) {
		await db
			.insert(appSettings)
			.values({ key: key(name), value: meta })
			.onConflictDoUpdate({ target: appSettings.key, set: { value: meta, updatedAt: new Date() } });
	},

	async remove(name: string) {
		await db.delete(appSettings).where(eq(appSettings.key, key(name)));
	},

	async all(): Promise<Record<string, RemoteMeta>> {
		const rows = await db.select().from(appSettings).where(like(appSettings.key, "remote.%"));
		return Object.fromEntries(rows.map((r) => [r.key.slice("remote.".length), r.value as RemoteMeta]));
	},
};
