"use client";
import type { Torrent } from "@/lib/api";
import { formatBytes, formatEta, formatSince, formatSpeed } from "@/lib/format";
import type { TorrentProperties } from "@/lib/useTorrentDetail";

const dash = "—";

/** Two-column definition list. Values are tabular so live numbers do not jitter. */
function Facts({ title, rows }: { title: string; rows: Array<[string, React.ReactNode]> }) {
	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<h3 className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
				{title}
			</h3>
			<dl className="divide-y divide-border">
				{rows.map(([k, v]) => (
					<div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2">
						<dt className="shrink-0 text-sm text-fg-muted">{k}</dt>
						<dd className="tabular min-w-0 truncate text-right text-sm text-fg">{v}</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

const secs = (s?: number) => {
	if (s === undefined || s < 0) return dash;
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m ${s % 60}s`;
};

const epoch = (t?: number) => (t && t > 0 ? new Date(t * 1000).toLocaleString() : dash);

export function DetailGeneral({ torrent, props }: { torrent: Torrent; props: TorrentProperties }) {
	const done = torrent.status === "completed";

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<Facts
				title="Transfer"
				rows={[
					["Time active", secs(torrent.timeActiveSeconds)],
					["ETA", done ? dash : formatEta(torrent.etaSeconds)],
					[
						"Connections",
						props.nb_connections !== undefined
							? `${props.nb_connections} of ${props.nb_connections_limit ?? dash}`
							: dash,
					],
					["Seeds", `${torrent.seedsConnected} connected of ${torrent.seedsTotal} in swarm`],
					["Peers", `${torrent.peersConnected} connected of ${torrent.peersTotal} in swarm`],
					["Downloaded", formatBytes(torrent.downloadedBytes)],
					["Uploaded", formatBytes(torrent.uploadedBytes)],
					["Wasted", formatBytes(props.total_wasted ?? torrent.wastedBytes ?? 0)],
					[
						"Download speed",
						`${formatSpeed(torrent.dlSpeedBps)}${props.dl_speed_avg ? ` · avg ${formatSpeed(props.dl_speed_avg)}` : ""}`,
					],
					[
						"Upload speed",
						`${formatSpeed(torrent.upSpeedBps)}${props.up_speed_avg ? ` · avg ${formatSpeed(props.up_speed_avg)}` : ""}`,
					],
					["Share ratio", torrent.ratio.toFixed(2)],
					// qBittorrent reports availability < 1 when no complete copy is
					// reachable — the honest answer to "why is this stuck".
					["Availability", torrent.availability > 0 ? torrent.availability.toFixed(2) : dash],
					["Reannounce in", secs(props.reannounce)],
					["Last activity", torrent.lastActivityAt ? formatSince(torrent.lastActivityAt) : dash],
				]}
			/>

			<Facts
				title="Information"
				rows={[
					["Total size", formatBytes(torrent.sizeBytes)],
					[
						"Pieces",
						props.pieces_num
							? `${props.pieces_have ?? 0} of ${props.pieces_num} × ${formatBytes(props.piece_size ?? 0)}`
							: dash,
					],
					["Added on", torrent.addedAt ? new Date(torrent.addedAt).toLocaleString() : dash],
					["Completed on", torrent.completedAt ? new Date(torrent.completedAt).toLocaleString() : dash],
					["Created on", epoch(props.creation_date)],
					["Created by", props.created_by || dash],
					["Private", props.isPrivate ? "yes" : "no"],
					[
						"Info hash v1",
						<span key="h1" className="font-mono text-xs">
							{torrent.infoHash}
						</span>,
					],
					["Save path", torrent.savePath || dash],
					["Comment", props.comment || dash],
				]}
			/>
		</div>
	);
}
