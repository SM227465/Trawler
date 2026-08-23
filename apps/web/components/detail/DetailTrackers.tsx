"use client";
import { cn } from "@/lib/cn";
import type { Tracker } from "@/lib/useTorrentDetail";

/** qBittorrent's tracker status enum. 4 is the one that means something is wrong. */
const STATUS: Record<number, { label: string; tone: string }> = {
	0: { label: "Disabled", tone: "text-fg-subtle" },
	1: { label: "Not contacted", tone: "text-fg-muted" },
	2: { label: "Working", tone: "text-status-completed" },
	3: { label: "Updating", tone: "text-status-downloading" },
	4: { label: "Not working", tone: "text-status-errored" },
};

export function DetailTrackers({ trackers }: { trackers: Tracker[] }) {
	if (trackers.length === 0) {
		return (
			<p className="rounded-[var(--ct-radius)] border border-border bg-surface p-8 text-center text-sm text-fg-muted">
				No trackers yet.
			</p>
		);
	}

	return (
		<div className="overflow-x-auto rounded-[var(--ct-radius)] border border-border bg-surface">
			<table className="w-full min-w-[46rem] text-sm">
				<thead>
					<tr className="border-b border-border text-left text-[0.625rem] uppercase tracking-wide text-fg-subtle">
						<th className="px-3 py-2 font-medium">URL</th>
						<th className="px-3 py-2 font-medium">Status</th>
						<th className="px-3 py-2 text-right font-medium">Tier</th>
						<th className="px-3 py-2 text-right font-medium">Seeds</th>
						<th className="px-3 py-2 text-right font-medium">Peers</th>
						<th className="px-3 py-2 text-right font-medium">Leeches</th>
						<th className="px-3 py-2 text-right font-medium">Downloaded</th>
					</tr>
				</thead>
				<tbody>
					{trackers.map((t) => {
						const s = STATUS[t.status] ?? { label: `Status ${t.status}`, tone: "text-fg-muted" };
						return (
							<tr key={t.url} className="border-b border-border last:border-b-0">
								<td className="max-w-sm truncate px-3 py-2 text-fg" title={t.url}>
									{t.url}
								</td>
								<td className={cn("px-3 py-2", s.tone)}>
									{s.label}
									{/* The message is where "unregistered torrent" or a rate limit
									    actually shows up — worth surfacing, not hiding. */}
									{t.msg ? <span className="block text-xs text-fg-subtle">{t.msg}</span> : null}
								</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{t.tier === -1 ? "—" : (t.tier ?? "—")}</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{t.num_seeds ?? "—"}</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{t.num_peers ?? "—"}</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{t.num_leeches ?? "—"}</td>
								<td className="tabular px-3 py-2 text-right text-fg-muted">{t.num_downloaded ?? "—"}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
