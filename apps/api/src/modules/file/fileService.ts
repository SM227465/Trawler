import path from "node:path";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { QbittorrentError, qbt } from "@/integrations/qbittorrent/client";
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

		// The same token works on /remux, which hands the bytes to ffmpeg first.
		// The browse links always carried this; torrent file links never did, so
		// every MKV opened from the files dialog or a torrent's page went
		// straight to "your browser cannot play this one" — including the H.264
		// ones the file browser plays fine.
		const remuxPath = `/remux/${token}/${encodeURIComponent(`${filename.replace(/\.[^.]+$/, "")}.mp4`)}`;

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
			remuxPath,
			remuxUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}${remuxPath}`,
		};

		return ServiceResponse.success("Download link created", link);
	}

	async listByTorrent(torrentId: string) {
		const rows = await fileRepository.listByTorrent(torrentId);
		return ServiceResponse.success("Files retrieved", rows);
	}

	/**
	 * qBittorrent first, then the row — never the other way round.
	 *
	 * This used to write only the database. The poller re-reads every file from
	 * qBittorrent every 10 seconds and overwrites this column, so the request
	 * returned 200 with the new priority, the download did not change at all,
	 * and the value quietly reverted within ten seconds. qBittorrent is the
	 * source of truth; the row is a cache of it.
	 */
	async setPriority(fileId: string, priority: number) {
		const row = await fileRepository.findWithTorrent(fileId);
		if (!row) {
			return ServiceResponse.failure("File not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}
		if (row.torrentStatus === "evicted") {
			return ServiceResponse.failure(
				"This torrent has been cleaned up, so there is nothing left to download",
				null,
				ErrorCode.RESOURCE_NOT_FOUND,
				"RESOURCE_NOT_FOUND",
			);
		}

		try {
			await qbt.setFilePriority(row.infoHash, [row.file.qbtIndex], priority);
		} catch (err) {
			if (!(err instanceof QbittorrentError)) throw err;
			logger.warn({ err: err.message, fileId, status: err.status }, "qBittorrent refused a file priority change");

			// 404: removed from qBittorrent behind our back. Anything else — down,
			// or a 409 for metadata that has not arrived — means the change did
			// not happen, and saying so beats pretending it did.
			return err.status === 404
				? ServiceResponse.failure(
						"qBittorrent no longer has this torrent",
						null,
						ErrorCode.RESOURCE_NOT_FOUND,
						"RESOURCE_NOT_FOUND",
					)
				: ServiceResponse.failure(
						"qBittorrent did not accept the change",
						null,
						ErrorCode.QBITTORRENT_UNAVAILABLE,
						"QBITTORRENT_UNAVAILABLE",
					);
		}

		const [updated] = await fileRepository.setPriority(fileId, priority);
		return ServiceResponse.success("Priority updated", updated ?? { ...row.file, priority });
	}
}

export const fileService = new FileService();
