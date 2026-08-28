import { open, stat } from "node:fs/promises";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { isShareIdShape } from "@/modules/share/shareId";
import { egressRepository } from "./egressRepository";

/**
 * Tails Caddy's JSON access log into `egress_daily`.
 *
 * Egress is counted where the BYTES actually leave — Caddy — not where they are
 * authorised. The authz endpoint charges a share's own quota optimistically at
 * request time (it never sees a transfer finish), but the Oracle allowance is
 * billed on real traffic, so this is the number that has to be real.
 */

const MAX_BATCH_BYTES = 8 * 1024 * 1024;

interface AccessLine {
	ts?: number;
	size?: number;
	status?: number;
	request?: { uri?: string; method?: string };
}

/** `/dl/<token>/...` and `/zip/<token>/...` — a share id is distinguishable by shape. */
export function shareIdFromUri(uri: string | undefined): string | null {
	if (!uri) return null;
	const path = uri.split("?")[0];
	const m = /^\/(?:dl|zip)\/([^/]+)/.exec(path);
	if (!m) return null;
	const token = decodeURIComponent(m[1]);
	// A JWT (owner download) contains dots and is far longer; only nanoid-shaped
	// ids are shares.
	return isShareIdShape(token) ? token : null;
}

export async function ingestEgressLog(): Promise<{ lines: number; bytes: number; skipped: number }> {
	const logPath = env.CADDY_ACCESS_LOG;
	let stored = await egressRepository.getOffset();
	const result = { lines: 0, bytes: 0, skipped: 0 };

	let size: number;
	try {
		size = (await stat(logPath)).size;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// No log yet is normal on a fresh box. Anything else is not, and this
		// swallowed EACCES silently for weeks: Caddy creates the file 0600 as
		// root, this worker runs as uid 1000, and the allowance meter therefore
		// read zero no matter how much was served. A guard that fails quietly is
		// worse than no guard, because it is trusted.
		if (code !== "ENOENT") {
			logger.error({ err, code, logPath }, "cannot read the Caddy access log — egress is NOT being counted");
		}
		return result;
	}

	// Caddy rolls the file. A shrink means the old one was rotated away. The
	// rolled copy is deliberately not chased: double-counting egress is worse
	// than missing the tail of one file.
	if (size < stored) {
		logger.info({ stored, size }, "access log rotated - restarting from 0");
		stored = 0;
	}
	if (size === stored) return result;

	const readTo = Math.min(size, stored + MAX_BATCH_BYTES);
	const fh = await open(logPath, "r");
	let consumed = stored;

	try {
		const length = readTo - stored;
		const buf = Buffer.alloc(length);
		await fh.read(buf, 0, length, stored);

		const text = buf.toString("utf8");
		// Whole lines only: the last one may be a half-written record.
		const lastNewline = text.lastIndexOf("\n");
		if (lastNewline < 0) return result;

		const complete = text.slice(0, lastNewline);
		consumed = stored + Buffer.byteLength(complete, "utf8") + 1;

		// Aggregate in memory first, so it is one UPSERT per bucket, not per line.
		const buckets = new Map<string, number>();

		for (const line of complete.split("\n")) {
			if (!line.trim()) continue;

			let entry: AccessLine;
			try {
				entry = JSON.parse(line) as AccessLine;
			} catch {
				result.skipped++;
				continue;
			}

			const bytes = entry.size ?? 0;
			if (bytes <= 0) continue;

			// ts is seconds with a fraction. Bucket by UTC day so the total is
			// stable regardless of the box's timezone.
			const day = new Date((entry.ts ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
			const shareId = shareIdFromUri(entry.request?.uri);
			const key = `${day} ${shareId ?? ""}`;

			buckets.set(key, (buckets.get(key) ?? 0) + bytes);
			result.lines++;
			result.bytes += bytes;
		}

		for (const [key, bytes] of buckets) {
			const [day, share] = key.split(" ");
			try {
				await egressRepository.addBytes(day, share || null, bytes);
			} catch {
				// A share deleted since the request would violate the FK. Fall back
				// to the owner bucket rather than losing the bytes entirely.
				await egressRepository.addBytes(day, null, bytes);
			}
		}
	} finally {
		await fh.close();
		await egressRepository.setOffset(consumed);
	}

	if (result.lines > 0) logger.debug(result, "egress ingested");
	return result;
}
