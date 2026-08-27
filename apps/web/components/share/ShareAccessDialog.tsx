"use client";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { api, type ShareAccessEntry } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatSince } from "@/lib/format";

const KIND: Record<ShareAccessEntry["kind"], { label: string; tone: string }> = {
	view: { label: "Opened", tone: "text-fg-muted" },
	download: { label: "Downloaded", tone: "text-status-completed" },
	denied: { label: "Refused", tone: "text-status-paused" },
	unlock_failed: { label: "Wrong password", tone: "text-status-errored" },
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
	return (
		<div className="rounded-[var(--ct-radius-sm)] bg-surface-inset px-3 py-2">
			<div className="text-[0.625rem] uppercase tracking-wide text-fg-subtle">{label}</div>
			<div className={cn("tabular mt-0.5 text-base font-semibold", tone ?? "text-fg")}>{value}</div>
		</div>
	);
}

export function ShareAccessDialog({ open, onClose, shareId }: { open: boolean; onClose: () => void; shareId: string }) {
	const { data, isLoading } = useQuery({
		queryKey: ["share-access", shareId],
		queryFn: () => api.shareAccess(shareId),
		enabled: open,
	});

	const s = data?.summary;

	return (
		<Dialog open={open} onClose={onClose} title="Who used this link" labelledBy="share-access-title">
			{isLoading && (
				<div className="mt-4 grid h-24 place-items-center">
					<LoaderCircle className="size-5 animate-spin text-fg-subtle" aria-hidden />
				</div>
			)}

			{s && (
				<>
					<div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
						{/* Visitors first: it is the number that reframes the others. Five
						    downloads from one address is you testing the link; five from
						    five addresses is the link circulating. */}
						<Stat label="Visitors" value={s.visitors} />
						<Stat label="Downloads" value={s.downloads} />
						<Stat label="Opened" value={s.views} />
						<Stat
							label="Refused"
							value={s.denied + s.unlockFailed}
							tone={s.denied + s.unlockFailed > 0 ? "text-status-errored" : undefined}
						/>
					</div>

					{s.unlockFailed > 0 && (
						<p className="mt-3 rounded-[var(--ct-radius-sm)] bg-status-errored-soft px-3 py-2 text-xs text-fg">
							<strong>{s.unlockFailed}</strong> failed password attempt
							{s.unlockFailed === 1 ? "" : "s"}. If you did not make those, treat this link as leaked and revoke it.
						</p>
					)}

					<div className="mt-4 max-h-72 overflow-y-auto rounded-[var(--ct-radius-sm)] border border-border">
						{data.entries.length === 0 ? (
							<p className="px-3 py-6 text-center text-sm text-fg-muted">Nobody has opened this link yet.</p>
						) : (
							<ul>
								{data.entries.map((e) => (
									<li key={e.id} className="flex items-baseline gap-3 border-b border-border px-3 py-2 last:border-b-0">
										<span className={cn("shrink-0 text-xs font-medium", KIND[e.kind].tone)}>{KIND[e.kind].label}</span>
										<span className="tabular min-w-0 flex-1 truncate text-xs text-fg-subtle" title={e.userAgent ?? ""}>
											{e.ip ?? "unknown"}
											{e.bytes > 0 && ` · ${formatBytes(e.bytes)}`}
										</span>
										<span className="shrink-0 text-xs text-fg-subtle" title={new Date(e.at).toLocaleString()}>
											{formatSince(e.at)}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
					<p className="mt-2 text-[0.6875rem] text-fg-subtle">Access history is kept for 30 days.</p>
				</>
			)}
		</Dialog>
	);
}
