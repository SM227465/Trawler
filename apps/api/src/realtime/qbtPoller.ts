import { eq, sql } from "drizzle-orm";
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
	selectedBytes: number;
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
	seedingTimeSeconds: number;
	savePath: string | null;
	contentPath: string | null;
	trackersCount: number;
	lastActivityAtMs: number | null;
	completedAtMs: number | null;
};

type WriteMark = { at: number; progressPct: number; status: string; selectedBytes: number };
/** The torrent as the last file sync saw it. */
type FileSyncMark = { at: number; progress: number; selectedBytes: number };

const toDto = (id: string, hash: string, t: QbtTorrent): TorrentDto => ({
	id,
	infoHash: hash,
	name: t.name ?? hash,
	sizeBytes: t.total_size ?? t.size ?? 0,
	// qBittorrent's `size` is the files selected for download; `total_size` is
	// all of them. They differ only once a file is set to skip.
	selectedBytes: t.size ?? t.total_size ?? 0,
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

	// These arrive in maindata and were simply never mapped, so the columns
	// doc 02 defines for them sat at their defaults forever. The detail view is
	// the first thing that reads them.
	//
	// NOT here on purpose: piecesHave/piecesNum/pieceSizeBytes/isPrivate/comment
	// come from /torrents/properties, which is polled only while a detail view
	// is open — the detail stream supplies them directly rather than round-
	// tripping through a column that would be stale the rest of the time.
	seedingTimeSeconds: t.seeding_time ?? 0,
	savePath: t.save_path ?? null,
	contentPath: t.content_path ?? null,
	trackersCount: t.trackers_count ?? 0,
	// EPOCH MILLIS, not a Date. `diff()` compares with !==, so a fresh Date
	// object would never equal the previous one and this field would ride along
	// in every single 1 Hz delta frame — silently undoing the delta compression.
	lastActivityAtMs: t.last_activity && t.last_activity > 0 ? t.last_activity * 1000 : null,
	// When qBittorrent saw the torrent finish; unset (≤ 0) until it has.
	completedAtMs: t.completion_on && t.completion_on > 0 ? t.completion_on * 1000 : null,
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
	private fileSyncs = new Map<string, FileSyncMark>();
	/** Infohashes with a file sync in flight. */
	private fileSyncing = new Set<string>();
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
	 *
	 * Tells clients here, while the id is still known. The tick used to look
	 * ids up AFTER forgetting them, so every "removed" frame went out empty and
	 * deleted torrents lingered in other tabs' counts until a reload.
	 */
	forget(infoHash: string) {
		const id = this.ids.get(infoHash);
		if (id) sseHub.broadcast(GLOBAL_CHANNEL, "removed", [id]);
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
				this.maybeSyncFiles(id, dto, now);
			}

			if (deltas.length) sseHub.broadcast(GLOBAL_CHANNEL, "torrents", deltas);

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
					selectedBytes: t.size ?? null,
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
		// Changes only when a file is skipped or un-skipped — rare, and a page
		// load must not show the old selection for up to 30 seconds after one.
		if (mark.selectedBytes !== dto.selectedBytes) return true;
		return Date.now() - mark.at >= WRITE_MAX_AGE_MS;
	}

	private async persist(items: Array<{ id: string; dto: TorrentDto }>) {
		for (const { id, dto } of items) {
			const completed = dto.status === "completed";
			const updated = await db
				.update(torrents)
				.set({
					name: dto.name,
					sizeBytes: dto.sizeBytes,
					selectedBytes: dto.selectedBytes,
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
					seedingTimeSeconds: dto.seedingTimeSeconds,
					savePath: dto.savePath,
					contentPath: dto.contentPath,
					trackersCount: dto.trackersCount,
					// Back to a Date only at the boundary; the DTO keeps millis so
					// diff() can compare it.
					lastActivityAt: dto.lastActivityAtMs ? new Date(dto.lastActivityAtMs) : null,
					// A completed torrent is re-persisted every 30 s, so stamping
					// now() here kept moving the date forward and the eviction TTL,
					// measured from it, never ran out. qBittorrent's own completion
					// time is fixed; without one, set it once and leave it.
					...(completed
						? {
								completedAt: dto.completedAtMs
									? new Date(dto.completedAtMs)
									: sql`coalesce(${torrents.completedAt}, now())`,
							}
						: {}),
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
				selectedBytes: dto.selectedBytes,
			});
		}
	}

	/**
	 * A torrent's files can only change when the torrent does: bytes arrive and
	 * its progress moves, or a file is skipped and its selected size moves.
	 * Stalled, paused and finished torrents are left alone — re-syncing all of
	 * them every 10 s is what kept a 2-core box pinned. Completion needs no
	 * special case: the last bytes move progress like any others.
	 */
	private maybeSyncFiles(torrentId: string, dto: TorrentDto, now: number) {
		const hash = dto.infoHash;
		if (dto.sizeBytes <= 0 || this.fileSyncing.has(hash)) return;
		const mark = this.fileSyncs.get(hash);
		if (mark) {
			if (mark.progress === dto.progress && mark.selectedBytes === dto.selectedBytes) return;
			if (now - mark.at < FILE_SYNC_MS) return;
		}
		this.fileSyncs.set(hash, { at: now, progress: dto.progress, selectedBytes: dto.selectedBytes });
		void this.syncFiles(torrentId, hash);
	}

	private async syncFiles(torrentId: string, hash: string) {
		this.fileSyncing.add(hash);
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
			// Without this a stalled torrent would keep its stale files: nothing
			// would move again to trigger the retry.
			this.fileSyncs.delete(hash);
			logger.warn({ err, torrentId }, "file sync failed");
		} finally {
			this.fileSyncing.delete(hash);
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
