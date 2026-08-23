import { realpath } from "node:fs/promises";
import path from "node:path";
import { env } from "@/common/utils/envConfig";

/**
 * Turns a DB-stored relative file path into the URI Caddy will serve.
 *
 * WHY THIS EXISTS: `torrent_files.path` originates from the .torrent metadata,
 * which is ATTACKER-CONTROLLED. qBittorrent sanitises it, but we must not make
 * that a security assumption — a malicious or malformed torrent could carry
 * `../../etc/passwd`. Every path is therefore resolved and proven to sit inside
 * DOWNLOADS_DIR before any header is emitted.
 *
 * The token→path indirection already makes traversal structurally hard (the URL
 * never names a path), so this is defence in depth, not the only line.
 */

const root = path.resolve(env.DOWNLOADS_DIR);

export type ResolveResult = { ok: true; absPath: string; accelPath: string } | { ok: false; reason: string };

export function resolveDownloadPath(relPath: string): ResolveResult {
	if (!relPath) return { ok: false, reason: "empty path" };
	// A NUL byte can truncate the path in a downstream C call.
	if (relPath.includes("\0")) return { ok: false, reason: "null byte in path" };
	if (path.isAbsolute(relPath)) return { ok: false, reason: "absolute path" };

	const absPath = path.resolve(root, relPath);

	// `startsWith(root)` alone is wrong: "/downloads-evil" starts with
	// "/downloads". The separator is what makes it a containment check.
	if (absPath !== root && !absPath.startsWith(root + path.sep)) {
		return { ok: false, reason: "path escapes downloads root" };
	}

	// Caddy rewrites the request URI to this value, so it must be a valid URI
	// path: encode each segment, keep the separators.
	const relative = path.relative(root, absPath);
	const accelPath = `/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;

	return { ok: true, absPath, accelPath };
}

/**
 * Containment check that also defeats SYMLINKS.
 *
 * `resolveDownloadPath` normalises `..` but cannot see through a symlink: a
 * torrent containing a link to /etc would resolve to a path that looks contained
 * and then serves something else entirely. realpath() collapses the link first,
 * so the check applies to the file that will actually be read.
 *
 * Falls back to the lexical check when the target does not exist (ENOENT), which
 * is the right answer for a 404 rather than a 500.
 */
export async function resolveRealPath(relPath: string): Promise<ResolveResult> {
	const lexical = resolveDownloadPath(relPath);
	if (!lexical.ok) return lexical;

	try {
		const real = await realpath(lexical.absPath);
		const realRoot = await realpath(root);
		if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
			return { ok: false, reason: "symlink escapes downloads root" };
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			return { ok: false, reason: "path could not be resolved" };
		}
	}

	return lexical;
}

export const downloadsRoot = root;
