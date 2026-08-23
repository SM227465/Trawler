"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Subscribes to one torrent's detail stream.
 *
 * The subscription IS the URL (doc 04 §3.1): mounting this hook opens the
 * EventSource, which starts the server-side pollers for that torrent; unmounting
 * closes it, and the server stops polling qBittorrent for it entirely. Leaking
 * this connection means the box keeps working for a torrent nobody is watching,
 * so the cleanup below is load-bearing, not tidiness.
 */

export interface TorrentProperties {
	pieces_have?: number;
	pieces_num?: number;
	piece_size?: number;
	total_wasted?: number;
	nb_connections?: number;
	nb_connections_limit?: number;
	dl_speed_avg?: number;
	up_speed_avg?: number;
	reannounce?: number;
	creation_date?: number;
	created_by?: string;
	comment?: string;
	isPrivate?: boolean;
	seeds?: number;
	seeds_total?: number;
	peers?: number;
	peers_total?: number;
	[key: string]: unknown;
}

export interface Tracker {
	url: string;
	tier?: number;
	status: number;
	num_peers?: number;
	num_seeds?: number;
	num_leeches?: number;
	num_downloaded?: number;
	msg?: string;
}

export interface Peer {
	key: string;
	ip?: string;
	port?: number;
	client?: string;
	country?: string;
	country_code?: string;
	connection?: string;
	flags?: string;
	flags_desc?: string;
	progress?: number;
	dl_speed?: number;
	up_speed?: number;
	downloaded?: number;
	uploaded?: number;
	relevance?: number;
	files?: string;
}

export interface PieceMap {
	total: number;
	rle: Array<[state: number, count: number]>;
}

export interface TorrentDetail {
	properties: TorrentProperties;
	trackers: Tracker[];
	peers: Peer[];
	peerTotal: number;
	peersCapped: boolean;
	pieces: PieceMap | null;
	connected: boolean;
}

const EMPTY: TorrentDetail = {
	properties: {},
	trackers: [],
	peers: [],
	peerTotal: 0,
	peersCapped: false,
	pieces: null,
	connected: false,
};

export function useTorrentDetail(torrentId: string | null): TorrentDetail {
	const [detail, setDetail] = useState<TorrentDetail>(EMPTY);
	const esRef = useRef<EventSource | null>(null);

	useEffect(() => {
		if (!torrentId) return;

		// EventSource cannot set headers, so this authenticates with the
		// GET-only ct_access cookie — the same mechanism the global stream uses.
		const es = new EventSource(`/api/v1/torrents/${torrentId}/events`);
		esRef.current = es;

		es.onopen = () => setDetail((d) => ({ ...d, connected: true }));
		es.onerror = () => setDetail((d) => ({ ...d, connected: false }));

		// `properties` frames carry only what changed, so they merge.
		es.addEventListener("properties", (e) => {
			const patch = JSON.parse((e as MessageEvent).data) as TorrentProperties;
			setDetail((d) => ({ ...d, properties: { ...d.properties, ...patch } }));
		});

		es.addEventListener("trackers", (e) => {
			setDetail((d) => ({ ...d, trackers: JSON.parse((e as MessageEvent).data) as Tracker[] }));
		});

		es.addEventListener("peers", (e) => {
			const p = JSON.parse((e as MessageEvent).data) as {
				peers: Peer[];
				total: number;
				capped: boolean;
			};
			setDetail((d) => ({ ...d, peers: p.peers, peerTotal: p.total, peersCapped: p.capped }));
		});

		es.addEventListener("pieces", (e) => {
			setDetail((d) => ({ ...d, pieces: JSON.parse((e as MessageEvent).data) as PieceMap }));
		});

		return () => {
			es.close();
			esRef.current = null;
			setDetail(EMPTY);
		};
	}, [torrentId]);

	return detail;
}
