import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { mediaRepository } from "@/modules/media/mediaRepository";
import { signDownloadToken } from "./downloadToken";
import { downloadsRoot, resolveRealPath } from "./filePath";
import { fileRepository } from "./fileRepository";
import { collectEntries } from "./zipService";

export interface BrowseEntry {
	name: string;
	path: string;
	type: "dir" | "file";
	sizeBytes: number;
	modifiedAt: string;
	/**
	 * What ffprobe found, when this path has been probed. `direct` plays as-is,
	 * `remux` needs the /remux route, `incompatible` goes to VLC. Absent means
	 * not probed yet, and the UI falls back to guessing by extension.
	 */
	playback?: "direct" | "remux" | "incompatible" | "not_media";
	durationSeconds?: number | null;

	/**
	 * Set when this path is a completed file of a tracked torrent. Shares are
	 * foreign-keyed to torrent_files, so a path with no row behind it cannot be
	 * shared and the UI hides the action rather than offering a dead button.
	 */
	fileId?: string;
}

/** Normalises the caller's path into a clean root-relative form ("" = root). */
function normalise(input: string | undefined): string {
	const raw = (input ?? "").replace(/^\/+/, "");
	return path.posix.normalize(raw) === "." ? "" : raw;
}

export class BrowseService {
	async list(rawPath: string | undefined) {
		const rel = normalise(rawPath);
		const resolved = await resolveRealPath(rel || ".");

		if (!resolved.ok) {
			logger.warn({ rawPath, reason: resolved.reason }, "browse refused");
			return ServiceResponse.failure("Path not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		let dirents: import("node:fs").Dirent[];
		try {
			dirents = await readdir(resolved.absPath, { withFileTypes: true });
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOTDIR" || code === "ENOENT") {
				return ServiceResponse.failure("Path not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
			}
			logger.error({ err, rel }, "browse failed");
			return ServiceResponse.failure("Could not read directory", null, ErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
		}

		const entries: BrowseEntry[] = [];
		for (const d of dirents) {
			// Skip qBittorrent's in-progress markers and dotfiles — neither is
			// something the user can usefully act on.
			if (d.name.startsWith(".") || d.name.endsWith(".!qB")) continue;

			const childRel = rel ? `${rel}/${d.name}` : d.name;
			try {
				const st = await stat(path.join(resolved.absPath, d.name));
				entries.push({
					name: d.name,
					path: childRel,
					type: st.isDirectory() ? "dir" : "file",
					sizeBytes: st.isDirectory() ? 0 : st.size,
					modifiedAt: st.mtime.toISOString(),
				});
			} catch {
				// A file deleted between readdir and stat is normal here.
			}
		}

		// Shares target torrent_files rows, not paths, so resolve which of these
		// entries are actually shareable. One query for the page.
		const fileIds = await fileRepository.idsByPaths(entries.filter((e) => e.type === "file").map((e) => e.path));
		for (const e of entries) {
			const id = fileIds.get(e.path);
			if (id) e.fileId = id;
		}

		// Probe verdicts for whatever has been probed. One query for the page,
		// and silence rather than a guess for anything that has not.
		const probes = await mediaRepository.playbackFor([...fileIds.values()]);
		for (const e of entries) {
			const probe = e.fileId ? probes.get(e.fileId) : undefined;
			if (probe) {
				e.playback = probe.playback;
				e.durationSeconds = probe.durationSeconds;
			}
		}

		// Folders first, then names naturally ordered so ep2 precedes ep10.
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
		entries.sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === "dir" ? -1 : 1));

		return ServiceResponse.success("Directory listing", {
			path: rel,
			parent: rel === "" ? null : path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel),
			root: path.basename(downloadsRoot),
			entries,
		});
	}

	/**
	 * A link for a FOLDER, served as a streamed zip. Separate from `link()`
	 * because it cannot go through Caddy — see zipService.
	 */
	async zipLink(rawPath: string | undefined, userId: string) {
		const rel = normalise(rawPath);
		if (!rel) {
			return ServiceResponse.failure("No folder specified", null, ErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
		}

		const resolved = await resolveRealPath(rel);
		if (!resolved.ok) {
			logger.error({ rel, reason: resolved.reason }, "zip link refused");
			return ServiceResponse.failure("Folder not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		try {
			const st = await stat(resolved.absPath);
			if (!st.isDirectory()) {
				return ServiceResponse.failure(
					"That is a file, not a folder",
					null,
					ErrorCode.VALIDATION_ERROR,
					"VALIDATION_ERROR",
				);
			}
		} catch {
			return ServiceResponse.failure("Folder not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		const entries = await collectEntries(rel);
		const token = await signDownloadToken({ dirPath: rel, userId });
		const name = path.basename(rel);

		return ServiceResponse.success("Zip link created", {
			url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/zip/${token}/${encodeURIComponent(name)}.zip`,
			path: `/zip/${token}/${encodeURIComponent(name)}.zip`,
			filename: `${name}.zip`,
			fileCount: entries.length,
			// The zip's own size is not known until the last byte, so this is the
			// payload total, not the download size. Close enough at store level.
			approxBytes: entries.reduce((sum, e) => sum + e.size, 0),
		});
	}

	/** A download link for an arbitrary browsed file — no DB row required. */
	async link(rawPath: string | undefined, userId: string) {
		const rel = normalise(rawPath);
		if (!rel) {
			return ServiceResponse.failure("No file specified", null, ErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
		}

		const resolved = await resolveRealPath(rel);
		if (!resolved.ok) {
			logger.error({ rel, reason: resolved.reason }, "browse link refused");
			return ServiceResponse.failure("File not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		let size = 0;
		try {
			const st = await stat(resolved.absPath);
			if (st.isDirectory()) {
				return ServiceResponse.failure(
					"That is a folder, not a file",
					null,
					ErrorCode.VALIDATION_ERROR,
					"VALIDATION_ERROR",
				);
			}
			size = st.size;
		} catch {
			return ServiceResponse.failure("File not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		const token = await signDownloadToken({ filePath: rel, userId });
		const filename = path.basename(rel);

		// The same token serves both routes: /dl hands the raw bytes to Caddy,
		// /remux hands them to ffmpeg first. Which one the player uses is decided
		// by the probe, not by the extension.
		const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
		const encoded = encodeURIComponent(filename);
		const remuxName = `${filename.replace(/\.[^.]+$/, "")}.mp4`;

		return ServiceResponse.success("Download link created", {
			path: `/dl/${token}/${encoded}`,
			url: `${base}/dl/${token}/${encoded}`,
			remuxPath: `/remux/${token}/${encodeURIComponent(remuxName)}`,
			remuxUrl: `${base}/remux/${token}/${encodeURIComponent(remuxName)}`,
			filename,
			sizeBytes: size,
		});
	}

	/**
	 * Deletes one file or directory under the downloads root.
	 *
	 * Deliberately manual-only: nothing in this app removes user data on its own,
	 * so this is reached exclusively from an explicit button behind a confirm.
	 *
	 * Refuses to delete the root itself — an empty path used to mean "the whole
	 * library", which is one mistyped request away from wiping every download.
	 */
	async remove(rawPath: string | undefined) {
		const rel = normalise(rawPath);
		if (!rel) {
			return ServiceResponse.failure(
				"Refusing to delete the downloads root",
				null,
				ErrorCode.VALIDATION_ERROR,
				"VALIDATION_ERROR",
			);
		}

		const resolved = await resolveRealPath(rel);
		if (!resolved.ok) {
			logger.warn({ rawPath, reason: resolved.reason }, "delete refused");
			return ServiceResponse.failure("Path not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}
		if (resolved.absPath === downloadsRoot) {
			return ServiceResponse.failure(
				"Refusing to delete the downloads root",
				null,
				ErrorCode.VALIDATION_ERROR,
				"VALIDATION_ERROR",
			);
		}

		let isDir = false;
		try {
			isDir = (await stat(resolved.absPath)).isDirectory();
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				return ServiceResponse.failure("Path not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
			}
			logger.error({ err, rel }, "delete stat failed");
			return ServiceResponse.failure("Could not delete", null, ErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
		}

		try {
			await rm(resolved.absPath, { recursive: isDir, force: false });
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			// EROFS means the downloads volume is mounted read-only into this
			// container — a deployment problem, not a bad request. It surfaced as
			// a bare 500 the first time and was invisible from the UI, so name it.
			if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
				logger.error({ err, rel, code }, "delete refused by the filesystem — is /downloads mounted read-write?");
				return ServiceResponse.failure(
					"The downloads volume is not writable by the server",
					null,
					ErrorCode.INTERNAL_ERROR,
					"DOWNLOADS_NOT_WRITABLE",
				);
			}
			logger.error({ err, rel, code }, "delete failed");
			return ServiceResponse.failure("Could not delete", null, ErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
		}

		logger.info({ path: rel, isDir }, "path deleted by user");
		return ServiceResponse.success("Deleted", { path: rel, type: isDir ? "dir" : "file" });
	}
}

export const browseService = new BrowseService();
