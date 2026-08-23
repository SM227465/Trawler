import { logger } from "@/common/utils/logger";
import { qbt } from "@/integrations/qbittorrent/client";
import type { QbtPeer, QbtProperties, QbtTracker } from "@/integrations/qbittorrent/types";
import { sseHub, torrentChannel } from "./sseHub";

/**
 * Per-torrent telemetry, polled ONLY while a detail view is open.
 *
 * The subscription IS the URL (doc 04 §3.1): opening the detail EventSource
 * starts a poller for that hash, closing it stops one. When nobody is looking at
 * a torrent the box does no work for it at all — which is what makes four extra
 * qBittorrent endpoints affordable on a 1 GB VPS.
 */

const PEERS_MS = 1000;
const PROPS_MS = 2000;
const PIECES_MS = 2000;
const TRACKERS_MS = 30_000;

/** Doc 04 §3.4 — peer counts run past 200 and nobody scrolls to the slow ones. */
const PEER_CAP = 200;

type Pieces = Array<[state: number, count: number]>;

/**
 * Run-length encode the piece array. A 20 GB torrent has ~10,000 pieces; sending
 * that as JSON every 2 s is absurd, and a mostly-complete torrent compresses to
 * a handful of pairs.
 */
export function rlePieces(states: number[]): Pieces {
	const out: Pieces = [];
	for (const s of states) {
		const last = out[out.length - 1];
		if (last && last[0] === s) last[1]++;
		else out.push([s, 1]);
	}
	return out;
}

/** Only the fields that changed, so a frame stays small. */
function diff<T extends Record<string, unknown>>(prev: T | null, next: T): Partial<T> | null {
	if (!prev) return next;
	const changed: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(next)) {
		if (prev[k as keyof T] !== v) changed[k] = v;
	}
	return Object.keys(changed).length > 0 ? (changed as Partial<T>) : null;
}

interface Session {
	hash: string;
	timers: ReturnType<typeof setInterval>[];
	peersRid: number;
	peers: Map<string, QbtPeer>;
	lastProps: QbtProperties | null;
	lastPiecesKey: string;
	lastTrackersKey: string;
}

class DetailPoller {
	private sessions = new Map<string, Session>();

	/** Called when a detail EventSource opens. Idempotent per torrent. */
	subscribe(torrentId: string, hash: string) {
		if (this.sessions.has(torrentId)) return;

		const session: Session = {
			hash,
			timers: [],
			peersRid: 0,
			peers: new Map(),
			lastProps: null,
			lastPiecesKey: "",
			lastTrackersKey: "",
		};
		this.sessions.set(torrentId, session);

		const every = (ms: number, fn: () => Promise<void>) => {
			const t = setInterval(() => {
				// A dead subscriber list means the last viewer left between ticks.
				if (sseHub.countFor(torrentChannel(torrentId)) === 0) {
					this.unsubscribe(torrentId);
					return;
				}
				void fn().catch((err) => logger.warn({ err, torrentId }, "detail poll failed"));
			}, ms);
			t.unref?.();
			session.timers.push(t);
		};

		every(PEERS_MS, () => this.pollPeers(torrentId, session));
		every(PROPS_MS, () => this.pollProperties(torrentId, session));
		every(PIECES_MS, () => this.pollPieces(torrentId, session));
		every(TRACKERS_MS, () => this.pollTrackers(torrentId, session));

		// Fire once immediately so the view is not blank for a whole interval.
		void Promise.all([
			this.pollProperties(torrentId, session),
			this.pollPeers(torrentId, session),
			this.pollPieces(torrentId, session),
			this.pollTrackers(torrentId, session),
		]).catch(() => {
			/* individual pollers already log */
		});

		logger.debug({ torrentId, hash }, "detail poller started");
	}

	unsubscribe(torrentId: string) {
		const s = this.sessions.get(torrentId);
		if (!s) return;
		for (const t of s.timers) clearInterval(t);
		this.sessions.delete(torrentId);
		logger.debug({ torrentId }, "detail poller stopped");
	}

	stopAll() {
		for (const id of [...this.sessions.keys()]) this.unsubscribe(id);
	}

	private async pollProperties(torrentId: string, s: Session) {
		const props = await qbt.properties(s.hash);
		const changed = diff(s.lastProps as Record<string, unknown> | null, props as unknown as Record<string, unknown>);
		s.lastProps = props;
		if (changed) sseHub.broadcast(torrentChannel(torrentId), "properties", changed);
	}

	private async pollPeers(torrentId: string, s: Session) {
		const sync = await qbt.peersSync(s.hash, s.peersRid);
		s.peersRid = sync.rid ?? s.peersRid;

		if (sync.full_update) s.peers.clear();
		for (const [key, peer] of Object.entries(sync.peers ?? {})) {
			s.peers.set(key, { ...s.peers.get(key), ...peer });
		}
		for (const key of sync.peers_removed ?? []) s.peers.delete(key);

		// Sorted by download speed so the cap keeps the peers that matter.
		const all = [...s.peers.entries()].map(([key, p]) => ({ key, ...p }));
		all.sort((a, b) => (b.dl_speed ?? 0) - (a.dl_speed ?? 0));

		sseHub.broadcast(torrentChannel(torrentId), "peers", {
			peers: all.slice(0, PEER_CAP),
			total: all.length,
			capped: all.length > PEER_CAP,
		});
	}

	private async pollPieces(torrentId: string, s: Session) {
		const states = await qbt.pieceStates(s.hash);
		const rle = rlePieces(states);
		// Cheap equality: the encoding is already a compact canonical form.
		const key = JSON.stringify(rle);
		if (key === s.lastPiecesKey) return;
		s.lastPiecesKey = key;
		sseHub.broadcast(torrentChannel(torrentId), "pieces", { total: states.length, rle });
	}

	private async pollTrackers(torrentId: string, s: Session) {
		const trackers: QbtTracker[] = await qbt.trackers(s.hash);
		const key = JSON.stringify(trackers);
		if (key === s.lastTrackersKey) return;
		s.lastTrackersKey = key;
		sseHub.broadcast(torrentChannel(torrentId), "trackers", trackers);
	}
}

export const detailPoller = new DetailPoller();
