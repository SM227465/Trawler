"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, refreshSession, type Torrent } from "./api";
import { useCacheOnly } from "./useCacheOnly";

export interface QbtStats {
	dl_info_speed?: number;
	up_info_speed?: number;
	dl_info_data?: number;
	up_info_data?: number;
	alltime_dl?: number;
	alltime_ul?: number;
	global_ratio?: string;
	dht_nodes?: number;
	connection_status?: string;
	free_space_on_disk?: number;
	total_peer_connections?: number;
	use_alt_speed_limits?: boolean;
}

/**
 * The list holds IDs only; each torrent is its own cache entry. That is what
 * keeps a 1 Hz update from re-rendering the whole table — a row subscribes to
 * ["torrent", id] and nothing else. Doc 04 §6.
 */
export const TORRENT_IDS_KEY = ["torrent-ids"] as const;
export const torrentKey = (id: string) => ["torrent", id] as const;

/**
 * A compact index for filtering and counts: id, name, status only.
 * Updated ONLY when name or status actually changes — never on a speed tick —
 * so the list can filter without re-rendering when numbers move.
 */
export const TORRENT_INDEX_KEY = ["torrent-index"] as const;
export interface TorrentIndexEntry {
	id: string;
	name: string;
	status: string;
	sizeBytes: number;
	progress: number;
	dlSpeedBps: number;
	upSpeedBps: number;
	seedsConnected: number;
	peersConnected: number;
	etaSeconds: number | null;
	addedAt: string;
}

const toIndexEntry = (t: Torrent): TorrentIndexEntry => ({
	id: t.id,
	name: t.name,
	status: t.status as string,
	sizeBytes: t.sizeBytes,
	progress: t.progress,
	dlSpeedBps: t.dlSpeedBps,
	upSpeedBps: t.upSpeedBps,
	seedsConnected: t.seedsConnected,
	peersConnected: t.peersConnected,
	etaSeconds: t.etaSeconds ?? null,
	addedAt: t.addedAt as unknown as string,
});

/** Stable identity — a fresh [] each render would defeat memoisation downstream. */
const EMPTY_INDEX: TorrentIndexEntry[] = [];

/**
 * Read-only view of the torrent index. The SSE stream owns writing it; every
 * consumer goes through here so nobody re-derives the cache-only pattern wrong.
 */
export function useTorrentIndex(): TorrentIndexEntry[] {
	return useCacheOnly<TorrentIndexEntry[]>(TORRENT_INDEX_KEY, EMPTY_INDEX);
}

const SORTABLE_KEYS = [
	"name",
	"status",
	"sizeBytes",
	"progress",
	"dlSpeedBps",
	"upSpeedBps",
	"seedsConnected",
	"peersConnected",
	"etaSeconds",
] as const;
export const STATS_KEY = ["qbt-stats"] as const;

type Delta = Partial<Torrent> & { id: string };

/**
 * SSE → TanStack Query cache. Frames carry only changed fields (doc 04 §3.2),
 * so every update is a shallow merge, never a refetch. Components read from
 * the cache; nothing here triggers a network request.
 */
export function useTorrentStream(enabled: boolean) {
	const qc = useQueryClient();
	const [connected, setConnected] = useState(false);
	const retryRef = useRef(0);

	useEffect(() => {
		if (!enabled) return;

		let es: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let closed = false;

		const connect = () => {
			if (closed) return;
			// Authenticated by the ct_access cookie — EventSource cannot set headers.
			es = new EventSource("/api/v1/events", { withCredentials: true });

			es.onopen = () => {
				setConnected(true);
				retryRef.current = 0;
			};

			es.addEventListener("stats", (e) => {
				const patch = JSON.parse((e as MessageEvent).data) as QbtStats;
				qc.setQueryData<QbtStats>(STATS_KEY, (prev) => ({ ...(prev ?? {}), ...patch }));
			});

			es.addEventListener("torrents", (e) => {
				const deltas = JSON.parse((e as MessageEvent).data) as Delta[];
				if (!deltas.length) return;

				const fresh: string[] = [];
				let indexDirty = false;

				for (const d of deltas) {
					const existed = qc.getQueryData<Torrent>(torrentKey(d.id)) !== undefined;

					if (existed) {
						qc.setQueryData<Torrent>(torrentKey(d.id), (prev) => (prev ? { ...prev, ...d } : prev));
					} else {
						// A delta carries only what CHANGED. Casting one to Torrent for
						// a torrent we have never seen wrote a half-object into the
						// cache — no name, no sizeBytes, no peer counts — and because
						// useQuery then had data it never fetched the real thing. The
						// row rendered blank with "NaN (NaN)" where the swarm should be,
						// and toIndexEntry copied the same holes into the sort index.
						//
						// Fetch the whole torrent instead. One GET, only for genuinely
						// new ids, and the row shows its placeholder until it lands.
						void qc.fetchQuery({ queryKey: torrentKey(d.id), queryFn: () => api.getTorrent(d.id) });
					}

					if (!existed) fresh.push(d.id);
					// The index backs filtering AND sorting, so it tracks every
					// sortable field. Rows still own their full data, so a tick
					// re-renders the list's id array — not the rows themselves.
					if (!existed || SORTABLE_KEYS.some((k) => d[k] !== undefined)) indexDirty = true;
				}

				if (indexDirty) {
					qc.setQueryData<TorrentIndexEntry[]>(TORRENT_INDEX_KEY, (prev) => {
						const next = prev ? [...prev] : [];
						for (const d of deltas) {
							const full = qc.getQueryData<Torrent>(torrentKey(d.id));
							if (!full) continue;
							const entry = toIndexEntry(full);
							const i = next.findIndex((e) => e.id === d.id);
							if (i >= 0) next[i] = entry;
							else next.unshift(entry);
						}
						return next;
					});
				}
				if (fresh.length) {
					qc.setQueryData<string[]>(TORRENT_IDS_KEY, (prev) => [
						...fresh.filter((id) => !prev?.includes(id)),
						...(prev ?? []),
					]);
				}
			});

			es.addEventListener("removed", (e) => {
				const ids = JSON.parse((e as MessageEvent).data) as string[];
				qc.setQueryData<string[]>(TORRENT_IDS_KEY, (prev) => prev?.filter((i) => !ids.includes(i)) ?? []);
				qc.setQueryData<TorrentIndexEntry[]>(
					TORRENT_INDEX_KEY,
					(prev) => prev?.filter((e) => !ids.includes(e.id)) ?? [],
				);
				for (const id of ids) qc.removeQueries({ queryKey: torrentKey(id) });
			});

			es.onerror = async () => {
				setConnected(false);
				es?.close();
				if (closed) return;

				// The access cookie outlives the token it carries; a refresh mints
				// a new one. Without this the stream would retry-fail forever.
				await refreshSession();

				const delay = Math.min(1000 * 2 ** retryRef.current, 15_000);
				retryRef.current += 1;
				reconnectTimer = setTimeout(connect, delay);
			};
		};

		connect();

		return () => {
			closed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			// Hard close on unmount — a leaked EventSource keeps the server
			// polling qBittorrent forever. Doc 04 §6.
			es?.close();
			setConnected(false);
		};
	}, [enabled, qc]);

	return { connected };
}
