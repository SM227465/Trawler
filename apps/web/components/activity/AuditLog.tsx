"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { type AuditEntry, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatSince } from "@/lib/format";

/** Plain-English labels. The stored values are dotted verbs meant for querying. */
const LABELS: Record<string, string> = {
	"auth.login": "Signed in",
	"auth.login_failed": "Failed sign-in",
	"auth.logout": "Signed out",
	"torrent.add": "Added a torrent",
	"torrent.remove": "Removed a torrent",
	"file.delete": "Deleted",
	"share.create": "Created a share link",
	"share.revoke": "Revoked a share link",
	"settings.transfer": "Changed transfer limits",
	"settings.storage": "Changed storage settings",
	"storage.evict": "Ran cleanup",
};

/**
 * Failed sign-ins lead deliberately. One account, exposed to the whole
 * internet — that filter is the reason to open this page at all.
 */
const FILTERS: { label: string; action?: string }[] = [
	{ label: "All" },
	{ label: "Failed sign-ins", action: "auth.login_failed" },
	{ label: "Sign-ins", action: "auth.login" },
	{ label: "Shares created", action: "share.create" },
	{ label: "Shares revoked", action: "share.revoke" },
	{ label: "Deletions", action: "file.delete" },
	{ label: "Torrents removed", action: "torrent.remove" },
];

/** The one line of context worth showing inline for each kind of entry. */
function detail(e: AuditEntry): string | null {
	const m = e.metadata ?? {};
	if (e.action === "auth.login_failed" || e.action === "auth.login") {
		return typeof m.email === "string" ? m.email : null;
	}
	if (e.action === "torrent.remove") return m.deleteFiles ? "files deleted too" : "kept the files";
	if (e.action === "file.delete") return e.targetId;
	if (e.action === "share.create") {
		const bits = [typeof m.label === "string" && m.label ? m.label : null, m.hasPassword ? "password" : null].filter(
			Boolean,
		);
		return bits.length ? bits.join(" · ") : null;
	}
	return e.targetId;
}

export function AuditLog() {
	const [action, setAction] = useState<string | undefined>(undefined);

	const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
		queryKey: ["audit", action ?? "all"],
		queryFn: ({ pageParam }) => api.audit({ limit: 50, before: pageParam, action }),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});

	const entries = data?.pages.flatMap((p) => p.entries) ?? [];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap gap-1.5">
				{FILTERS.map((f) => {
					const active = f.action === action;
					return (
						<button
							key={f.label}
							type="button"
							onClick={() => setAction(f.action)}
							aria-pressed={active}
							className={cn(
								"h-8 cursor-pointer rounded-full px-3 text-xs transition-colors",
								active ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg",
							)}
						>
							{f.label}
						</button>
					);
				})}
			</div>

			<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
				{isLoading && <p className="px-4 py-8 text-center text-sm text-fg-muted">Reading…</p>}
				{isError && <p className="px-4 py-8 text-center text-sm text-status-errored">Could not load activity.</p>}
				{!isLoading && !isError && entries.length === 0 && (
					<p className="px-4 py-8 text-center text-sm text-fg-muted">Nothing recorded yet.</p>
				)}

				{entries.length > 0 && (
					<ul>
						{entries.map((e) => {
							const info = detail(e);
							const bad = e.action === "auth.login_failed";
							return (
								<li
									key={e.id}
									className="flex items-baseline gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
								>
									<span className={cn("shrink-0", bad ? "text-status-errored" : "text-fg")}>
										{LABELS[e.action] ?? e.action}
									</span>
									{info && (
										<span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={info}>
											{info}
										</span>
									)}
									<span className="ml-auto shrink-0 text-xs text-fg-subtle" title={new Date(e.at).toLocaleString()}>
										{formatSince(e.at)}
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</section>

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
