"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
	FolderMinus,
	Link2,
	Link2Off,
	LoaderCircle,
	LogIn,
	LogOut,
	Plus,
	ShieldAlert,
	SlidersHorizontal,
	Trash,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { type AuditEntry, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatSince } from "@/lib/format";

type Tone = "neutral" | "good" | "warn" | "bad";

/**
 * One row of presentation per action: an icon, a plain-English label, and a
 * tone. The stored values are dotted verbs meant for querying, not reading.
 */
const KINDS: Record<string, { label: string; icon: typeof LogIn; tone: Tone }> = {
	"auth.login": { label: "Signed in", icon: LogIn, tone: "neutral" },
	"auth.login_failed": { label: "Failed sign-in", icon: ShieldAlert, tone: "bad" },
	"auth.logout": { label: "Signed out", icon: LogOut, tone: "neutral" },
	"torrent.add": { label: "Added a torrent", icon: Plus, tone: "good" },
	"torrent.remove": { label: "Removed a torrent", icon: Trash, tone: "warn" },
	"file.delete": { label: "Deleted", icon: FolderMinus, tone: "warn" },
	"share.create": { label: "Created a share link", icon: Link2, tone: "good" },
	"share.revoke": { label: "Revoked a share link", icon: Link2Off, tone: "warn" },
	"settings.transfer": { label: "Changed transfer limits", icon: SlidersHorizontal, tone: "neutral" },
	"settings.storage": { label: "Changed storage settings", icon: SlidersHorizontal, tone: "warn" },
	"storage.evict": { label: "Ran cleanup", icon: Trash2, tone: "warn" },
};

const TONE: Record<Tone, { dot: string; icon: string }> = {
	neutral: { dot: "bg-border-strong", icon: "bg-surface-inset text-fg-subtle" },
	good: { dot: "bg-status-completed", icon: "bg-status-completed-soft text-status-completed" },
	warn: { dot: "bg-status-paused", icon: "bg-status-paused-soft text-status-paused" },
	bad: { dot: "bg-status-errored", icon: "bg-status-errored-soft text-status-errored" },
};

/**
 * Actions where the source address changes how you read the entry. A failed
 * sign-in from an address you recognise is a typo; the same from one you do not
 * is someone trying the door.
 */
const SHOW_IP = new Set(["auth.login", "auth.login_failed", "auth.logout"]);

const FILTERS: { label: string; action?: string }[] = [
	{ label: "All" },
	{ label: "Failed sign-ins", action: "auth.login_failed" },
	{ label: "Sign-ins", action: "auth.login" },
	{ label: "Torrents added", action: "torrent.add" },
	{ label: "Torrents removed", action: "torrent.remove" },
	{ label: "Shares created", action: "share.create" },
	{ label: "Shares revoked", action: "share.revoke" },
	{ label: "Deletions", action: "file.delete" },
];

/** The one line of context worth showing inline for each kind of entry. */
function detail(e: AuditEntry): string | null {
	const m = e.metadata ?? {};
	if (e.action.startsWith("auth.login")) return typeof m.email === "string" ? m.email : null;
	if (e.action === "torrent.add") return typeof m.name === "string" ? m.name : e.targetId;
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

/** Groups consecutive entries under a day heading, in arrival order. */
function byDay(entries: AuditEntry[]) {
	const out: { day: string; items: AuditEntry[] }[] = [];
	for (const e of entries) {
		const day = new Date(e.at).toDateString();
		const last = out.at(-1);
		if (last?.day === day) last.items.push(e);
		else out.push({ day, items: [e] });
	}
	return out;
}

function dayLabel(day: string) {
	const today = new Date().toDateString();
	const yesterday = new Date(Date.now() - 86_400_000).toDateString();
	if (day === today) return "Today";
	if (day === yesterday) return "Yesterday";
	return new Date(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
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
	const days = byDay(entries);

	return (
		<div className="flex flex-col gap-4">
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
					Could not load activity.
				</p>
			)}
			{!isLoading && !isError && entries.length === 0 && (
				<p className="rounded-[var(--ct-radius)] border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
					Nothing recorded yet. Actions are logged from the moment they happen — nothing is backfilled.
				</p>
			)}

			{days.map(({ day, items }) => (
				<section key={day}>
					<h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{dayLabel(day)}</h2>

					{/* A timeline rather than a table: these are events in order, and
					    the rail makes the sequence readable at a glance. */}
					<ol className="relative rounded-[var(--ct-radius)] border border-border bg-surface p-4">
						<span aria-hidden className="absolute bottom-6 left-[2.125rem] top-6 w-px bg-border" />
						{items.map((e) => {
							const kind = KINDS[e.action] ?? {
								label: e.action,
								icon: SlidersHorizontal,
								tone: "neutral" as Tone,
							};
							const Icon = kind.icon;
							const info = detail(e);
							return (
								<li key={e.id} className="relative flex gap-3 py-2">
									<span
										className={cn(
											"relative z-10 grid size-7 shrink-0 place-items-center rounded-full",
											TONE[kind.tone].icon,
										)}
									>
										<Icon className="size-3.5" aria-hidden />
									</span>

									<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
										<span className={cn("text-sm", kind.tone === "bad" ? "text-status-errored" : "text-fg")}>
											{kind.label}
										</span>

										{/* Shown inline only where the address is the point — a
										    sign-in, or an attempt at one. On "changed a setting" it
										    is noise, and it is still on the timestamp's tooltip. */}
										{e.ip && SHOW_IP.has(e.action) && (
											<span
												className="tabular shrink-0 rounded bg-surface-inset px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted"
												title={e.userAgent ?? "unknown client"}
											>
												{e.ip}
											</span>
										)}

										{info && (
											<span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={info}>
												{info}
											</span>
										)}
									</span>

									<span
										className="shrink-0 self-center text-xs text-fg-subtle"
										title={`${new Date(e.at).toLocaleString()}${e.ip ? ` · ${e.ip}` : ""}`}
									>
										{formatSince(e.at)}
									</span>
								</li>
							);
						})}
					</ol>
				</section>
			))}

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
