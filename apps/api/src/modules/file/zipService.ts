import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
// archiver v8 exports named classes; the callable default of v5/v6 is gone.
import { ZipArchive } from "archiver";
import type { Response } from "express";
import { logger } from "@/common/utils/logger";
import { resolveRealPath } from "./filePath";

/**
 * Streamed folder download.
 *
 * This is the ONE place bytes pass through Node, and it is unavoidable: a zip
 * has to be produced by something, and Caddy cannot. Everything here exists to
 * keep that cost as close to a passthrough as possible.
 *
 *   · store, not deflate — the payload is already-compressed video. Compressing
 *     it burns CPU to make the file marginally BIGGER.
 *   · zip64 — a torrent folder can easily exceed the 4 GB / 65535-entry limits.
 *   · a hard concurrency cap — two of these on a 1 GB Oracle box is plenty.
 *
 * No Content-Length and no Range: the size is not known until the last byte is
 * written, so the response is chunked and cannot be resumed. That is inherent to
 * streaming a zip, and the UI says so rather than letting it surprise anyone.
 */

const MAX_CONCURRENT = 2;
let active = 0;

export interface ZipEntry {
	absPath: string;
	relPath: string;
	size: number;
}

/** Depth-first walk, refusing anything that escapes the downloads root. */
export async function collectEntries(relDir: string): Promise<ZipEntry[]> {
	const out: ZipEntry[] = [];

	async function walk(rel: string) {
		const resolved = await resolveRealPath(rel);
		if (!resolved.ok) {
			logger.warn({ rel, reason: resolved.reason }, "zip: skipping path outside the downloads root");
			return;
		}

		const dirents = await readdir(resolved.absPath, { withFileTypes: true });
		for (const d of dirents) {
			if (d.name.startsWith(".") || d.name.endsWith(".!qB")) continue;
			const childRel = `${rel}/${d.name}`;

			if (d.isDirectory()) {
				await walk(childRel);
				continue;
			}
			// Symlinks are walked through resolveRealPath, never followed blindly.
			const child = await resolveRealPath(childRel);
			if (!child.ok) continue;

			try {
				const st = await stat(child.absPath);
				if (st.isFile()) {
					out.push({
						absPath: child.absPath,
						relPath: path.relative(relDir, childRel).split(path.sep).join("/"),
						size: st.size,
					});
				}
			} catch {
				/* vanished between readdir and stat */
			}
		}
	}

	await walk(relDir);
	return out;
}

export async function streamZip(relDir: string, res: Response): Promise<void> {
	if (active >= MAX_CONCURRENT) {
		res.status(503).setHeader("Retry-After", "30").end();
		return;
	}

	const entries = await collectEntries(relDir);
	if (entries.length === 0) {
		res.status(404).end();
		return;
	}

	active++;
	const name = path.basename(relDir) || "download";
	const archive = new ZipArchive({ zlib: { level: 0 }, store: true, forceZip64: true });

	// Set headers only once we know there is something to send — after this
	// point an error can no longer become a clean status code.
	res.setHeader("Content-Type", "application/zip");
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${name.replace(/["\\]/g, "")}.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
	);
	// The response is chunked; make it explicit that ranges are not supported.
	res.setHeader("Accept-Ranges", "none");

	archive.on("warning", (err: Error) => logger.warn({ err, relDir }, "zip warning"));
	archive.on("error", (err: Error) => {
		logger.error({ err, relDir }, "zip failed mid-stream");
		res.destroy(err);
	});

	// If the client goes away, stop reading files immediately.
	res.on("close", () => {
		if (!res.writableEnded) archive.abort();
	});

	archive.pipe(res);
	for (const e of entries) archive.append(createReadStream(e.absPath), { name: `${name}/${e.relPath}` });

	const total = entries.reduce((sum, e) => sum + e.size, 0);
	logger.info({ relDir, files: entries.length, totalBytes: total }, "streaming zip");

	try {
		await archive.finalize();
	} finally {
		active--;
	}
}
