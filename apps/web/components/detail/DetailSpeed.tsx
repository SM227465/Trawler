"use client";
import { Sparkline } from "@/components/system/Sparkline";
import type { Torrent } from "@/lib/api";
import { formatBytes, formatSpeed } from "@/lib/format";
import type { SpeedSample } from "@/lib/useSpeedHistory";
import type { TorrentProperties } from "@/lib/useTorrentDetail";

const rate = (v: number) => formatSpeed(v);

/**
 * Download and upload on ONE shared scale.
 *
 * Never a second y-axis: two measures of different magnitude get two charts or a
 * shared scale, never two axes on one plot (dataviz non-negotiable). Upload is
 * usually far smaller than download here, and that IS the information — a dual
 * axis would draw them the same height and imply parity that does not exist.
 *
 * Hues follow the entity, not its rank: download is viz-1 and upload viz-2, the
 * same assignment the System page's torrent-traffic chart uses, so the colours
 * mean the same thing in both places.
 */
export function DetailSpeed({
	torrent,
	props,
	history,
}: {
	torrent: Torrent;
	props: TorrentProperties;
	history: SpeedSample[];
}) {
	const dl = history.map((s) => s.dl);
	const up = history.map((s) => s.up);

	return (
		<div className="flex flex-col gap-4">
			<section className="rounded-[var(--ct-radius)] border border-border bg-surface p-4">
				<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
					<span className="tabular text-2xl font-semibold text-viz-1">{rate(torrent.dlSpeedBps)}</span>
					<span className="tabular text-2xl font-semibold text-viz-2">{rate(torrent.upSpeedBps)}</span>
					<span className="ml-auto text-xs text-fg-subtle">last {history.length}s</span>
				</div>

				<div className="mt-3">
					<Sparkline
						series={[
							{ label: "Download", values: dl, tone: "viz-1" },
							{ label: "Upload", values: up, tone: "viz-2" },
						]}
						format={rate}
					/>
				</div>

				{/* Two series, so a legend is always present — identity is never
				    carried by colour alone. */}
				<ul className="mt-2 flex gap-4 text-xs">
					<li className="flex items-center gap-1.5 text-fg-muted">
						<span className="size-2 rounded-full bg-viz-1" aria-hidden /> Download
					</li>
					<li className="flex items-center gap-1.5 text-fg-muted">
						<span className="size-2 rounded-full bg-viz-2" aria-hidden /> Upload
					</li>
				</ul>
			</section>

			<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{[
					["Average down", props.dl_speed_avg ? rate(props.dl_speed_avg) : "—"],
					["Average up", props.up_speed_avg ? rate(props.up_speed_avg) : "—"],
					["Downloaded", formatBytes(torrent.downloadedBytes)],
					["Uploaded", formatBytes(torrent.uploadedBytes)],
				].map(([k, v]) => (
					<div key={k} className="rounded-[var(--ct-radius)] border border-border bg-surface p-3">
						<dt className="text-xs uppercase tracking-wide text-fg-subtle">{k}</dt>
						<dd className="tabular mt-1 text-sm font-medium text-fg">{v}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
