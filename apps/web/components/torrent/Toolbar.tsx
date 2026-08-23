"use client";
import { ArrowDownUp, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TorrentIndexEntry } from "@/lib/useTorrentStream";
import { SORT_LABELS, type SortKey, type SortState } from "./sort";

export const FILTERS = [
	{ value: "all", label: "All" },
	{ value: "downloading", label: "Downloading" },
	{ value: "completed", label: "Complete" },
	{ value: "paused", label: "Paused" },
	{ value: "errored", label: "Error" },
] as const;

export type FilterValue = (typeof FILTERS)[number]["value"];

export function Toolbar({
	query,
	onQuery,
	filter,
	onFilter,
	index,
	sort,
	onSort,
}: {
	query: string;
	onQuery: (v: string) => void;
	filter: FilterValue;
	onFilter: (v: FilterValue) => void;
	index: TorrentIndexEntry[];
	sort: SortState;
	onSort: (s: SortState) => void;
}) {
	const count = (v: FilterValue) => (v === "all" ? index.length : index.filter((e) => e.status === v).length);

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
			<div className="relative sm:max-w-xs sm:flex-1">
				<Search
					className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
					aria-hidden
				/>
				<input
					value={query}
					onChange={(e) => onQuery(e.target.value)}
					placeholder="Search torrents…"
					aria-label="Search torrents"
					className={cn(
						"h-9 w-full rounded-[var(--ct-radius-sm)] pl-9 pr-8",
						"bg-surface-inset text-sm text-fg placeholder:text-fg-subtle",
						"border border-border focus:border-accent outline-none transition-colors",
					)}
				/>
				{query && (
					<button
						type="button"
						onClick={() => onQuery("")}
						aria-label="Clear search"
						className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-fg-subtle hover:text-fg cursor-pointer"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				)}
			</div>

			{/* Column headers are desktop-only, so mobile needs its own sort control. */}
			<label className="flex items-center gap-2 lg:hidden">
				<ArrowDownUp className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<span className="sr-only">Sort by</span>
				<select
					value={`${sort.key}:${sort.dir}`}
					onChange={(e) => {
						const [key, dir] = e.target.value.split(":");
						onSort({ key: key as SortKey, dir: dir as "asc" | "desc" });
					}}
					className={cn(
						"h-9 w-full rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2",
						"text-xs text-fg outline-none focus:border-accent cursor-pointer",
					)}
				>
					{(Object.keys(SORT_LABELS) as SortKey[]).flatMap((k) => [
						<option key={`${k}:desc`} value={`${k}:desc`}>
							{SORT_LABELS[k]} ↓
						</option>,
						<option key={`${k}:asc`} value={`${k}:asc`}>
							{SORT_LABELS[k]} ↑
						</option>,
					])}
				</select>
			</label>

			<div
				className="flex gap-1 overflow-x-auto rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-1"
				role="tablist"
				aria-label="Filter by status"
			>
				{FILTERS.map((f) => {
					const n = count(f.value);
					const active = filter === f.value;
					return (
						<button
							key={f.value}
							type="button"
							role="tab"
							aria-selected={active}
							onClick={() => onFilter(f.value)}
							className={cn(
								"flex shrink-0 items-center gap-1.5 rounded-[0.3rem] px-2.5 py-1 text-xs font-medium",
								"transition-colors cursor-pointer",
								active ? "bg-surface text-fg shadow-[var(--ct-shadow)]" : "text-fg-muted hover:text-fg",
							)}
						>
							{f.label}
							<span className={cn("tabular text-[0.6875rem]", active ? "text-fg-subtle" : "text-fg-subtle")}>{n}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
