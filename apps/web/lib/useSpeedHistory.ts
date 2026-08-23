"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Torrent } from "@/lib/api";
import { torrentKey } from "@/lib/useTorrentStream";

/**
 * A rolling window of one torrent's speeds.
 *
 * Built CLIENT-side rather than on the server: the global SSE stream already
 * delivers this torrent's dlSpeedBps/upSpeedBps every second, so keeping a
 * second history server-side would poll qBittorrent for numbers already in
 * flight and cost memory per torrent whether or not anyone is watching.
 *
 * The trade-off, stated plainly: the window resets when the detail view
 * unmounts. qBittorrent's own graph behaves the same way, and a speed chart is
 * about "what is happening now", not a durable record.
 */

const WINDOW = 90; // seconds, matching the System page

export interface SpeedSample {
	t: number;
	dl: number;
	up: number;
}

export function useSpeedHistory(torrentId: string | null): SpeedSample[] {
	const qc = useQueryClient();
	const [history, setHistory] = useState<SpeedSample[]>([]);
	const last = useRef<{ dl: number; up: number } | null>(null);

	useEffect(() => {
		if (!torrentId) return;
		setHistory([]);
		last.current = null;

		// Sampled on a timer rather than on every cache write: the SSE frame for
		// this torrent only arrives when something CHANGED, so a paused torrent
		// would otherwise flatline into a gap instead of a line at zero.
		const tick = setInterval(() => {
			const t = qc.getQueryData<Torrent>(torrentKey(torrentId));
			if (!t) return;
			const sample = { t: Date.now(), dl: t.dlSpeedBps ?? 0, up: t.upSpeedBps ?? 0 };
			last.current = { dl: sample.dl, up: sample.up };
			setHistory((prev) => {
				const next = prev.length >= WINDOW ? prev.slice(1) : prev.slice();
				next.push(sample);
				return next;
			});
		}, 1000);

		return () => clearInterval(tick);
	}, [torrentId, qc]);

	return history;
}
