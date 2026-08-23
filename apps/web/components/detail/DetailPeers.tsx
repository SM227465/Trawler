"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, formatSpeed } from "@/lib/format";
import type { Peer } from "@/lib/useTorrentDetail";

/**
 * Country flag from the ISO code, as an emoji — no image assets, no CDN, no
 * layout shift. Each letter maps to a regional-indicator codepoint.
 */
function flag(code?: string) {
	if (!code || code.length !== 2) return "";
	const base = 0x1f1e6;
	return String.fromCodePoint(...[...code.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65));
}

type SortKey = "dl_speed" | "up_speed" | "progress" | "downloaded" | "uploaded";

export function DetailPeers({ peers, total, capped }: { peers: Peer[]; total: number; capped: boolean }) {
	const [sort, setSort] = useState<SortKey>("dl_speed");

	if (total === 0) {
		return (
			<p className="rounded-[var(--ct-radius)] border border-border bg-surface p-8 text-center text-sm text-fg-muted">
				No peers connected. For a completed torrent with nobody downloading from you, this is normal.
			</p>
		);
	}

	const rows = [...peers].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));

	const Th = ({ k, label }: { k: SortKey; label: string }) => (
		<th className="px-3 py-2 text-right font-medium">
			<button
				type="button"
				onClick={() => setSort(k)}
				className={cn("cursor-pointer transition-colors hover:text-fg", sort === k ? "text-fg" : "")}
			>
				{label}
			</button>
		</th>
	);

	return (
		<div className="flex flex-col gap-2">
			{capped && (
				<p className="text-xs text-fg-subtle">
					Showing the {peers.length} fastest of {total} peers.
				</p>
			)}
			<div className="overflow-x-auto rounded-[var(--ct-radius)] border border-border bg-surface">
				<table className="w-full min-w-[52rem] text-sm">
					<thead>
						<tr className="border-b border-border text-left text-[0.625rem] uppercase tracking-wide text-fg-subtle">
							<th className="px-3 py-2 font-medium">Peer</th>
							<th className="px-3 py-2 font-medium">Client</th>
							<th className="px-3 py-2 font-medium">Flags</th>
							<Th k="progress" label="Progress" />
							<Th k="dl_speed" label="Down" />
							<Th k="up_speed" label="Up" />
							<Th k="downloaded" label="Downloaded" />
							<Th k="uploaded" label="Uploaded" />
						</tr>
					</thead>
					<tbody>
						{rows.map((p) => (
							<tr key={p.key} className="border-b border-border last:border-b-0">
								<td className="px-3 py-2 text-fg">
									<span className="mr-1.5" title={p.country}>
										{flag(p.country_code)}
									</span>
									<span className="tabular">{p.ip}</span>
									<span className="tabular text-fg-subtle">:{p.port}</span>
								</td>
								<td className="max-w-40 truncate px-3 py-2 text-fg-muted" title={p.client}>
									{p.client || "—"}
								</td>
								{/* flags_desc explains the cryptic letters; qBittorrent's own UI
								    hides it in a tooltip and so do we. */}
								<td className="px-3 py-2 font-mono text-xs text-fg-muted" title={p.flags_desc}>
									{p.flags || "—"}
								</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{((p.progress ?? 0) * 100).toFixed(0)}%</td>
								<td className="tabular px-3 py-2 text-right text-chart-dl">{formatSpeed(p.dl_speed ?? 0)}</td>
								<td className="tabular px-3 py-2 text-right text-chart-ul">{formatSpeed(p.up_speed ?? 0)}</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{formatBytes(p.downloaded ?? 0)}</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{formatBytes(p.uploaded ?? 0)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
