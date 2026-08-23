import path from "node:path";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { signDownloadToken } from "./downloadToken";
import type { DownloadLink } from "./fileModel";
import { resolveDownloadPath } from "./filePath";
import { fileRepository } from "./fileRepository";

/** Shell-quote for the copyable aria2c command; filenames contain anything. */
const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export class FileService {
	async getDownloadLink(fileId: string, userId: string) {
		const row = await fileRepository.findWithTorrent(fileId);
		if (!row) {
			return ServiceResponse.failure("File not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		const { file, torrentName } = row;

		// Serving a partial file hands the user a silently truncated download.
		// Note this is per FILE, not per torrent: pulling one finished file out
		// of a still-downloading torrent is a feature (doc 03 §A10).
		if (!file.isComplete) {
			return ServiceResponse.failure("File is still downloading", null, ErrorCode.PERMISSION_DENIED, "FILE_INCOMPLETE");
		}

		const resolved = resolveDownloadPath(file.path);
		if (!resolved.ok) {
			// Reaching here means a torrent carried a hostile path. Loud, because
			// it is either an attack or corruption — never routine.
			logger.error(
				{ fileId, torrentName, reason: resolved.reason },
				"refusing to serve a file whose path escapes the downloads root",
			);
			return ServiceResponse.failure("File path is invalid", null, ErrorCode.PERMISSION_DENIED, "PERMISSION_DENIED");
		}

		const token = await signDownloadToken({ fileId, userId });
		const filename = path.basename(file.path);

		// The suffix after the token is cosmetic — only the token selects the
		// file — but putting the real filename there makes the browser name the
		// download correctly with no Content-Disposition header (doc 01 §5.4).
		const url = `/dl/${token}/${encodeURIComponent(filename)}`;
		const absoluteUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}${url}`;

		await fileRepository.touchTorrent(file.torrentId);

		const link: DownloadLink = {
			url,
			absoluteUrl,
			filename,
			sizeBytes: file.sizeBytes,
			expiresAt: new Date(Date.now() + env.DOWNLOAD_TOKEN_TTL_SECONDS * 1000).toISOString(),
			// -x16 -s16: 16 parallel connections. A single browser TCP stream
			// badly underperforms on long-haul links (doc 01 §5.4).
			aria2c: `aria2c -x16 -s16 -o ${shellQuote(filename)} ${shellQuote(absoluteUrl)}`,
		};

		return ServiceResponse.success("Download link created", link);
	}

	async listByTorrent(torrentId: string) {
		const rows = await fileRepository.listByTorrent(torrentId);
		return ServiceResponse.success("Files retrieved", rows);
	}

	async setPriority(fileId: string, priority: number) {
		const [updated] = await fileRepository.setPriority(fileId, priority);
		if (!updated) {
			return ServiceResponse.failure("File not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}
		return ServiceResponse.success("Priority updated", updated);
	}
}

export const fileService = new FileService();
