import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { signDownloadToken } from "./downloadToken";
import { downloadsRoot, resolveRealPath } from "./filePath";
import { collectEntries } from "./zipService";

export interface BrowseEntry {
	name: string;
	path: string;
	type: "dir" | "file";
	sizeBytes: number;
	modifiedAt: string;
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

		return ServiceResponse.success("Download link created", {
			path: `/dl/${token}/${encodeURIComponent(filename)}`,
			url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/dl/${token}/${encodeURIComponent(filename)}`,
			filename,
			sizeBytes: size,
		});
	}
}

export const browseService = new BrowseService();
