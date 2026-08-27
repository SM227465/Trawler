"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, Eye, LoaderCircle, ShieldAlert, ShieldX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, type ShareAccessFeedEntry } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatSince } from "@/lib/format";

const KIND = {
	view: { label: "Opened a link", icon: Eye, tone: "bg-surface-inset text-fg-subtle", text: "text-fg" },
	download: {
		label: "Downloaded",
		icon: Download,
		tone: "bg-status-completed-soft text-status-completed",
		text: "text-fg",
	},
	denied: { label: "Refused", icon: ShieldX, tone: "bg-status-paused-soft text-status-paused", text: "text-fg" },
	unlock_failed: {
		label: "Wrong password",
		icon: ShieldAlert,
		tone: "bg-status-errored-soft text-status-errored",
		text: "text-status-errored",
	},
} as const;

const FILTERS: { label: string; kind?: string }[] = [
	{ label: "All" },
	{ label: "Wrong password", kind: "unlock_failed" },
	{ label: "Refused", kind: "denied" },
	{ label: "Downloads", kind: "download" },
	{ label: "Opens", kind: "view" },
];

export function ShareAccessFeed() {
	const [kind, setKind] = useState<string | undefined>(undefined);

	const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
		queryKey: ["share-access-feed", kind ?? "all"],
		queryFn: ({ pageParam }) => api.shareAccessFeed({ limit: 50, before: pageParam, kind }),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});

	const entries: ShareAccessFeedEntry[] = data?.pages.flatMap((p) => p.entries) ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap gap-1.5">
				{FILTERS.map((f) => {
					const active = f.kind === kind;
					return (
						<button
							key={f.label}
							type="button"
							onClick={() => setKind(f.kind)}
							aria-pressed={active}
							className={cn(
								"h-8 cursor-pointer rounded-full px-3 text-xs transition-colors",
								active ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:bg-surface-inset hover:text-fg",
							)}
						>
							{f.label}
						</button>
					);
				})}
			</div>

			{isLoading && (
				<div className="grid h-32 place-items-center rounded-[var(--ct-radius)] border border-border bg-surface">
					<LoaderCircle className="size-5 animate-spin text-fg-subtle" aria-hidden />
				</div>
			)}
			{isError && (
				<p className="rounded-[var(--ct-radius)] border border-border bg-surface px-4 py-8 text-center text-sm text-status-errored">
					Could not load share access.
				</p>
			)}
			{!isLoading && !isError && entries.length === 0 && (
				<p className="rounded-[var(--ct-radius)] border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
					Nobody has opened a share link yet.
				</p>
			)}

			{entries.length > 0 && (
				<ul className="divide-y divide-border rounded-[var(--ct-radius)] border border-border bg-surface">
					{entries.map((e) => {
						const k = KIND[e.kind];
						const Icon = k.icon;
						return (
							<li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
								<span className={cn("grid size-7 shrink-0 place-items-center rounded-full", k.tone)}>
									<Icon className="size-3.5" aria-hidden />
								</span>

								<span className={cn("shrink-0 text-sm", k.text)}>{k.label}</span>

								{/* The address is the point of this view: it is what tells you
								    whether one person used the link or forty did. */}
								<span
									className="tabular shrink-0 rounded bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-fg-muted"
									title={e.userAgent ?? "unknown client"}
								>
									{e.ip ?? "unknown"}
								</span>

								<span
									className="min-w-0 flex-1 truncate text-xs text-fg-subtle"
									title={e.reason ?? e.shareLabel ?? e.shareId}
								>
									{e.shareLabel ?? e.shareId}
									{e.bytes > 0 && ` · ${formatBytes(e.bytes)}`}
									{e.reason && ` · ${e.reason}`}
								</span>

								<span className="shrink-0 text-xs text-fg-subtle" title={new Date(e.at).toLocaleString()}>
									{formatSince(e.at)}
								</span>
							</li>
						);
					})}
				</ul>
			)}

			{hasNextPage && (
				<Button
					variant="subtle"
					size="sm"
					className="self-center"
					onClick={() => fetchNextPage()}
					disabled={isFetchingNextPage}
				>
					{isFetchingNextPage && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
					Load older
				</Button>
			)}
		</div>
	);
}
