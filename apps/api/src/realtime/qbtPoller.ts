import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";
import { torrents, users } from "@/db/schema";
import { QbittorrentError, qbt } from "@/integrations/qbittorrent/client";
import type { QbtServerState, QbtTorrent } from "@/integrations/qbittorrent/types";
import { torrentRepository } from "@/modules/torrent/torrentRepository";
import { mapState, normalizeEta } from "@/modules/torrent/torrentState";
import { GLOBAL_CHANNEL, sseHub } from "./sseHub";

const TICK_MS = 1_000;
const WRITE_MAX_AGE_MS = 30_000;
const FILE_SYNC_MS = 10_000;

/** Our wire shape. camelCase; only changed keys are sent (doc 04 §3.2). */
type TorrentDto = {
	id: string;
	infoHash: string;
	name: string;
	sizeBytes: number;
	status: string;
	qbtState: string;
	progress: number;
	dlSpeedBps: number;
	upSpeedBps: number;
	etaSeconds: number | null;
	seedsConnected: number;
	seedsTotal: number;
	peersConnected: number;
	peersTotal: number;
	ratio: number;
	availability: number;
	downloadedBytes: number;
	uploadedBytes: number;
	timeActiveSeconds: number;
	category: string;
	trackerHost: string;
};

type WriteMark = { at: number; progressPct: number; status: string };

const toDto = (id: string, hash: string, t: QbtTorrent): TorrentDto => ({
	id,
	infoHash: hash,
	name: t.name ?? hash,
	sizeBytes: t.total_size ?? t.size ?? 0,
	status: mapState(t.state),
	qbtState: t.state ?? "unknown",
	progress: t.progress ?? 0,
	dlSpeedBps: t.dlspeed ?? 0,
	upSpeedBps: t.upspeed ?? 0,
	etaSeconds: normalizeEta(t.eta),
	// num_seeds is peers we are CONNECTED to; num_complete is the whole swarm.
	// Conflating them is the classic bug — the UI shows "connected (swarm)".
	seedsConnected: t.num_seeds ?? 0,
	seedsTotal: t.num_complete ?? 0,
	peersConnected: t.num_leechs ?? 0,
	peersTotal: t.num_incomplete ?? 0,
	ratio: t.ratio ?? 0,
	availability: t.availability ?? 0,
	downloadedBytes: t.downloaded ?? 0,
	uploadedBytes: t.uploaded ?? 0,
	timeActiveSeconds: t.time_active ?? 0,
	category: t.category ?? "",
	trackerHost: t.tracker ? safeHost(t.tracker) : "",
});

const safeHost = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
};

/** Only the keys that actually changed. */
const diff = (prev: TorrentDto | undefined, next: TorrentDto): Partial<TorrentDto> & { id: string } => {
	if (!prev) return next;
	const out: Record<string, unknown> = { id: next.id };
	for (const [k, v] of Object.entries(next)) {
		if (k !== "id" && prev[k as keyof TorrentDto] !== v) out[k] = v;
	}
	return out as Partial<TorrentDto> & { id: string };
};

class QbtPoller {
	private rid = 0;
	private timer: NodeJS.Timeout | null = null;
	private running = false;
	private ownerId: string | null = null;

	/** merged qBittorrent state, keyed by infohash */
	private raw = new Map<string, QbtTorrent>();
	/** last DTO pushed to clients, for delta computation */
	private emitted = new Map<string, TorrentDto>();
	/** infohash → our uuid */
	private ids = new Map<string, string>();
	private writes = new Map<string, WriteMark>();
	private fileSyncs = new Map<string, number>();
	private lastServerState: QbtServerState = {};
	private degraded = false;

	async start() {
		if (this.timer) return;
		const owner = await db.query.users.findFirst();
		this.ownerId = owner?.id ?? null;

		for (const row of await db.select({ id: torrents.id, infoHash: torrents.infoHash }).from(torrents)) {
			this.ids.set(row.infoHash, row.id);
		}

		try {
			await qbt.ensureCategory();
		} catch (err) {
			logger.warn({ err }, "could not ensure qBittorrent category");
		}

		this.timer = setInterval(() => void this.tick(), TICK_MS);
		this.timer.unref();
		logger.info({ tickMs: TICK_MS, known: this.ids.size }, "qbt poller started");
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * Drop all cached state for an infohash. MUST be called whenever a torrent
	 * is removed through our API: otherwise `ids` keeps pointing at the deleted
	 * row's uuid, `ensureRows` sees the hash as known and skips re-adopting it,
	 * and every subsequent update silently targets a row that no longer exists.
	 */
	forget(infoHash: string) {
		this.ids.delete(infoHash);
		this.raw.delete(infoHash);
		this.emitted.delete(infoHash);
		this.writes.delete(infoHash);
		this.fileSyncs.delete(infoHash);
	}

	/** Read-only view of qBittorrent's global counters, for the system sampler. */
	serverState(): QbtServerState {
		return this.lastServerState;
	}

	/** Current state, for seeding a newly connected SSE client. */
	snapshot() {
		return {
			stats: this.lastServerState,
			torrents: [...this.emitted.values()],
		};
	}

	private async tick() {
		if (this.running) return; // never overlap
		this.running = true;
		try {
			const data = await qbt.syncMainData(this.rid);
			this.rid = data.rid ?? this.rid;

			if (this.degraded) {
				this.degraded = false;
				logger.info("qBittorrent reachable again");
			}

			if (data.full_update) {
				this.raw.clear();
				this.emitted.clear();
			}

			for (const hash of data.torrents_removed ?? []) {
				this.forget(hash);
			}

			for (const [hash, patch] of Object.entries(data.torrents ?? {})) {
				this.raw.set(hash, { ...(this.raw.get(hash) ?? {}), ...patch });
			}

			await this.ensureRows();

			const deltas: Array<Partial<TorrentDto> & { id: string }> = [];
			const toPersist: Array<{ id: string; dto: TorrentDto }> = [];
			const now = Date.now();

			for (const [hash, t] of this.raw) {
				const id = this.ids.get(hash);
				if (!id) continue;
				const dto = toDto(id, hash, t);
				const prev = this.emitted.get(hash);
				const d = diff(prev, dto);
				if (Object.keys(d).length > 1 || !prev) deltas.push(d);
				this.emitted.set(hash, dto);
				if (this.shouldPersist(hash, dto)) toPersist.push({ id, dto });

				// Per-file progress is what powers "download the finished episode
				// while the rest of the season is still going".
				const lastFileSync = this.fileSyncs.get(hash) ?? 0;
				if (dto.sizeBytes > 0 && now - lastFileSync >= FILE_SYNC_MS) {
					this.fileSyncs.set(hash, now);
					void this.syncFiles(id, hash);
				}
			}

			if (deltas.length) sseHub.broadcast(GLOBAL_CHANNEL, "torrents", deltas);
			if (data.torrents_removed?.length) {
				sseHub.broadcast(GLOBAL_CHANNEL, "removed", data.torrents_removed.map((h) => this.ids.get(h)).filter(Boolean));
			}

			const statsDelta = this.serverStateDelta(data.server_state);
			if (statsDelta) sseHub.broadcast(GLOBAL_CHANNEL, "stats", statsDelta);

			await this.persist(toPersist);
		} catch (err) {
			if (err instanceof QbittorrentError) {
				if (!this.degraded) {
					this.degraded = true;
					logger.warn({ err: err.message }, "qBittorrent unreachable — poller degraded");
				}
				this.rid = 0; // force a full snapshot on recovery
			} else {
				logger.error({ err }, "poller tick failed");
			}
		} finally {
			this.running = false;
		}
	}

	/** Adopt torrents added directly in qBittorrent, not through our API. */
	private async ensureRows() {
		if (!this.ownerId) return;
		for (const [hash, t] of this.raw) {
			if (this.ids.has(hash)) continue;
			const existing = await torrentRepository.findByInfoHash(hash);
			if (existing) {
				this.ids.set(hash, existing.id);
				continue;
			}
			const [row] = await db
				.insert(torrents)
				.values({
					id: uuidv7(),
					infoHash: hash,
					name: t.name ?? hash,
					addedBy: this.ownerId,
					status: mapState(t.state),
					sizeBytes: t.total_size ?? t.size ?? 0,
				})
				.onConflictDoNothing()
				.returning();
			if (row) {
				this.ids.set(hash, row.id);
				logger.info({ infoHash: hash }, "adopted torrent added outside the API");
			}
		}
	}

	/**
	 * Doc 04 §4. Persist only on a status change, a whole-percent progress step,
	 * or 30s since the last write. Without this: 50 torrents × 1 Hz = 4.3M
	 * writes/day for values that are worthless a second later.
	 */
	private shouldPersist(hash: string, dto: TorrentDto): boolean {
		const pct = Math.floor(dto.progress * 100);
		const mark = this.writes.get(hash);
		if (!mark) return true;
		if (mark.status !== dto.status) return true;
		if (mark.progressPct !== pct) return true;
		return Date.now() - mark.at >= WRITE_MAX_AGE_MS;
	}

	private async persist(items: Array<{ id: string; dto: TorrentDto }>) {
		for (const { id, dto } of items) {
			const now = new Date();
			const completed = dto.status === "completed";
			const updated = await db
				.update(torrents)
				.set({
					name: dto.name,
					sizeBytes: dto.sizeBytes,
					status: dto.status as never,
					qbtState: dto.qbtState,
					progress: dto.progress,
					dlSpeedBps: dto.dlSpeedBps,
					upSpeedBps: dto.upSpeedBps,
					etaSeconds: dto.etaSeconds,
					seedsConnected: dto.seedsConnected,
					seedsTotal: dto.seedsTotal,
					peersConnected: dto.peersConnected,
					peersTotal: dto.peersTotal,
					ratio: dto.ratio,
					availability: dto.availability,
					downloadedBytes: dto.downloadedBytes,
					uploadedBytes: dto.uploadedBytes,
					timeActiveSeconds: dto.timeActiveSeconds,
					category: dto.category,
					trackerHost: dto.trackerHost,
					...(completed ? { completedAt: now } : {}),
				})
				.where(eq(torrents.id, id))
				.returning({ id: torrents.id });

			// Belt and braces: if the row is gone, our cached id is stale. Drop it
			// so the next tick re-adopts the torrent against the real row.
			if (updated.length === 0) {
				logger.warn({ infoHash: dto.infoHash }, "stale torrent id in poller cache — re-adopting");
				this.forget(dto.infoHash);
				continue;
			}

			this.writes.set(dto.infoHash, {
				at: Date.now(),
				progressPct: Math.floor(dto.progress * 100),
				status: dto.status,
			});

			if (completed) void this.syncFiles(id, dto.infoHash);
		}
	}

	private async syncFiles(torrentId: string, hash: string) {
		try {
			const files = await qbt.files(hash);
			await torrentRepository.replaceFiles(
				torrentId,
				files.map((f, i) => ({
					qbtIndex: f.index ?? i,
					path: f.name,
					sizeBytes: f.size,
					progress: f.progress,
					priority: f.priority,
					isComplete: f.progress >= 1,
				})),
			);
		} catch (err) {
			logger.warn({ err, torrentId }, "file sync failed");
		}
	}

	private serverStateDelta(next: QbtServerState | undefined) {
		if (!next) return null;
		const merged = { ...this.lastServerState, ...next };
		const changed: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(merged)) {
			if (this.lastServerState[k as keyof QbtServerState] !== v) changed[k] = v;
		}
		this.lastServerState = merged;
		return Object.keys(changed).length ? changed : null;
	}
}

export const qbtPoller = new QbtPoller();
