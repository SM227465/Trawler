import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { logger } from "@/common/utils/logger";
import { QbittorrentError, qbt } from "@/integrations/qbittorrent/client";
import { qbtPoller } from "@/realtime/qbtPoller";
import { parseTorrentFile } from "./torrentBencode";
import { torrentRepository } from "./torrentRepository";
import { parseDisplayName, parseInfoHash } from "./torrentState";

const unavailable = (err: unknown) =>
	ServiceResponse.failure(
		"qBittorrent is unavailable",
		null,
		ErrorCode.QBITTORRENT_UNAVAILABLE,
		"QBITTORRENT_UNAVAILABLE",
	);

const notFound = () =>
	ServiceResponse.failure("Torrent not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");

export class TorrentService {
	async add(magnet: string, userId: string, pinned: boolean) {
		const infoHash = parseInfoHash(magnet);
		if (!infoHash) {
			return ServiceResponse.failure(
				"Could not read an infohash from that magnet link",
				null,
				ErrorCode.VALIDATION_ERROR,
				"VALIDATION_ERROR",
			);
		}

		// Idempotent on infohash — re-adding returns the existing row.
		const existing = await torrentRepository.findByInfoHash(infoHash);
		if (existing) return ServiceResponse.success("Torrent already added", existing);

		const row = await torrentRepository.create({
			infoHash,
			name: parseDisplayName(magnet) ?? infoHash,
			magnet,
			addedBy: userId,
			pinned,
			status: "queued",
		});

		try {
			await qbt.addMagnet(magnet);
		} catch (err) {
			// Roll the row back so a failed hand-off does not leave a ghost.
			await torrentRepository.delete(row.id);
			logger.error({ err, infoHash }, "qBittorrent rejected magnet");
			return unavailable(err);
		}

		logger.info({ infoHash, torrentId: row.id }, "torrent added");
		return ServiceResponse.success("Torrent added", row, 201);
	}

	async addFromFile(file: Buffer, filename: string, userId: string, pinned: boolean) {
		let meta: { infoHash: string; name: string | null };
		try {
			meta = parseTorrentFile(file);
		} catch (err) {
			return ServiceResponse.failure(
				`Not a valid .torrent file: ${(err as Error).message}`,
				null,
				ErrorCode.VALIDATION_ERROR,
				"VALIDATION_ERROR",
			);
		}

		const existing = await torrentRepository.findByInfoHash(meta.infoHash);
		if (existing) return ServiceResponse.success("Torrent already added", existing);

		const row = await torrentRepository.create({
			infoHash: meta.infoHash,
			name: meta.name ?? filename.replace(/\.torrent$/i, ""),
			addedBy: userId,
			pinned,
			status: "queued",
		});

		try {
			await qbt.addTorrentFile(file, filename);
		} catch (err) {
			await torrentRepository.delete(row.id);
			logger.error({ err, infoHash: meta.infoHash }, "qBittorrent rejected .torrent file");
			return unavailable(err);
		}

		logger.info({ infoHash: meta.infoHash, torrentId: row.id }, "torrent added from file");
		return ServiceResponse.success("Torrent added", row, 201);
	}

	/**
	 * Adds many at once. Each item is independent: one bad magnet in a pasted
	 * block of twenty must not discard the other nineteen, so every outcome is
	 * reported rather than thrown.
	 */
	async addMany(magnets: string[], userId: string) {
		const results: Array<{
			input: string;
			status: "added" | "duplicate" | "failed";
			id: string | null;
			name: string | null;
			error: string | null;
		}> = [];

		for (const raw of magnets) {
			const magnet = raw.trim();
			// Never log or echo a full magnet — it names exactly what is being
			// downloaded (doc 03 §A8).
			const label = magnet.slice(0, 60);

			try {
				const res = await this.add(magnet, userId, false);
				if (!res.success) {
					results.push({ input: label, status: "failed", id: null, name: null, error: res.message });
					continue;
				}
				const row = res.responseObject as { id: string; name: string } | null;
				results.push({
					input: label,
					status: res.statusCode === 201 ? "added" : "duplicate",
					id: row?.id ?? null,
					name: row?.name ?? null,
					error: null,
				});
			} catch (err) {
				results.push({ input: label, status: "failed", id: null, name: null, error: (err as Error).message });
			}
		}

		const summary = {
			results,
			added: results.filter((r) => r.status === "added").length,
			duplicates: results.filter((r) => r.status === "duplicate").length,
			failed: results.filter((r) => r.status === "failed").length,
		};
		logger.info({ added: summary.added, duplicates: summary.duplicates, failed: summary.failed }, "batch add");
		return ServiceResponse.success("Batch complete", summary);
	}

	/** Same contract as addMany, for uploaded .torrent files. */
	async addManyFiles(files: Array<{ buffer: Buffer; originalname: string }>, userId: string) {
		const results: Array<{
			input: string;
			status: "added" | "duplicate" | "failed";
			id: string | null;
			name: string | null;
			error: string | null;
		}> = [];

		for (const f of files) {
			try {
				const res = await this.addFromFile(f.buffer, f.originalname, userId, false);
				if (!res.success) {
					results.push({ input: f.originalname, status: "failed", id: null, name: null, error: res.message });
					continue;
				}
				const row = res.responseObject as { id: string; name: string } | null;
				results.push({
					input: f.originalname,
					status: res.statusCode === 201 ? "added" : "duplicate",
					id: row?.id ?? null,
					name: row?.name ?? null,
					error: null,
				});
			} catch (err) {
				results.push({ input: f.originalname, status: "failed", id: null, name: null, error: (err as Error).message });
			}
		}

		return ServiceResponse.success("Batch complete", {
			results,
			added: results.filter((r) => r.status === "added").length,
			duplicates: results.filter((r) => r.status === "duplicate").length,
			failed: results.filter((r) => r.status === "failed").length,
		});
	}

	async list(opts: { status?: string; q?: string; limit: number; offset: number }) {
		const { rows, total } = await torrentRepository.list(opts);
		return ServiceResponse.success("OK", {
			items: rows,
			pagination: { total, limit: opts.limit, offset: opts.offset, hasMore: opts.offset + rows.length < total },
		});
	}

	async get(id: string) {
		const row = await torrentRepository.findById(id);
		if (!row) return notFound();
		await torrentRepository.touch(id);
		return ServiceResponse.success("OK", row);
	}

	async files(id: string) {
		const row = await torrentRepository.findById(id);
		if (!row) return notFound();
		return ServiceResponse.success("OK", await torrentRepository.filesFor(id));
	}

	private async act(id: string, fn: (hash: string) => Promise<void>, message: string) {
		const row = await torrentRepository.findById(id);
		if (!row) return notFound();
		try {
			await fn(row.infoHash);
		} catch (err) {
			if (err instanceof QbittorrentError) return unavailable(err);
			throw err;
		}
		return ServiceResponse.success(message, null);
	}

	pause(id: string) {
		return this.act(id, (h) => qbt.pause(h), "Paused");
	}

	resume(id: string) {
		return this.act(id, (h) => qbt.resume(h), "Resumed");
	}

	recheck(id: string) {
		return this.act(id, (h) => qbt.recheck(h), "Rechecking");
	}

	async setPinned(id: string, pinned: boolean) {
		const row = await torrentRepository.findById(id);
		if (!row) return notFound();
		return ServiceResponse.success(pinned ? "Pinned" : "Unpinned", await torrentRepository.update(id, { pinned }));
	}

	async remove(id: string, deleteFiles: boolean) {
		const row = await torrentRepository.findById(id);
		if (!row) return notFound();
		try {
			// Always delete through qBittorrent, never rm — otherwise its state
			// diverges from the filesystem and it re-checks on next start.
			await qbt.remove(row.infoHash, deleteFiles);
		} catch (err) {
			if (err instanceof QbittorrentError) return unavailable(err);
			throw err;
		}
		await torrentRepository.delete(id);
		qbtPoller.forget(row.infoHash);
		logger.info({ torrentId: id, deleteFiles }, "torrent removed");
		return ServiceResponse.success("Torrent removed", null);
	}
}

export const torrentService = new TorrentService();
