"use client";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Inbox } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TORRENT_IDS_KEY, useTorrentIndex } from "@/lib/useTorrentStream";
import { COLUMNS, ROW_GRID } from "./grid";
import { Pagination } from "./Pagination";
import { COLUMN_SORT, compareEntries, type SortState } from "./sort";
import type { FilterValue } from "./Toolbar";
import { TorrentRow } from "./TorrentRow";

export function TorrentList({
	query,
	filter,
	sort,
	onSort,
	page,
	pageSize,
	onPage,
	onPageSize,
}: {
	query: string;
	filter: FilterValue;
	sort: SortState;
	onSort: (s: SortState) => void;
	/** 1-based, straight from the URL. */
	page: number;
	pageSize: number;
	onPage: (p: number) => void;
	onPageSize: (n: number) => void;
}) {
	// The URL is the source of truth; convert to the 0-based index used below.
	const pageIndex = Math.max(0, page - 1);
	const parentRef = useRef<HTMLDivElement>(null);

	// Seeds the id list once; SSE keeps it current from then on.
	const { data: allIds = [], isLoading } = useQuery<string[]>({
		queryKey: TORRENT_IDS_KEY,
		queryFn: async () => (await api.listTorrents({ limit: 200 })).items.map((t) => t.id),
	});

	const index = useTorrentIndex();

	// Client-side: under 200 torrents this is instant, and it avoids the
	// awkwardness of SSE pushing rows that fail a server-side filter.
	const sortedIds = useMemo(() => {
		const q = query.trim().toLowerCase();
		const byId = new Map(index.map((e) => [e.id, e]));

		const rows = allIds
			.map((id) => byId.get(id))
			.filter((e): e is NonNullable<typeof e> => Boolean(e))
			.filter((e) => (filter === "all" || e.status === filter) && (!q || e.name.toLowerCase().includes(q)));

		rows.sort((a, b) => compareEntries(a, b, sort));
		return rows.map((e) => e.id);
	}, [allIds, index, query, filter, sort]);

	const total = sortedIds.length;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));

	// A filter or search that shrinks the result set can strand us on a page
	// that no longer exists.
	useEffect(() => {
		if (pageIndex > pageCount - 1) onPage(1);
	}, [pageIndex, pageCount, onPage]);

	const ids = useMemo(
		() => sortedIds.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize),
		[sortedIds, pageIndex, pageSize],
	);

	const scrollToTop = useRef<HTMLDivElement | null>(null);
	const changePage = (p: number) => {
		onPage(p + 1);
		scrollToTop.current?.scrollTo({ top: 0 });
	};

	const toggleSort = (key: NonNullable<(typeof COLUMN_SORT)[number]>) => {
		onSort(
			sort.key === key
				? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
				: // Text reads naturally A→Z; numbers are most useful biggest-first.
					{ key, dir: key === "name" ? "asc" : "desc" },
		);
	};

	const virtualizer = useVirtualizer({
		count: ids.length,
		getScrollElement: () => parentRef.current,
		// Rows are taller on mobile (stacked) than desktop (single line), so the
		// estimate is a starting point and measureElement corrects it.
		estimateSize: () => 116,
		overscan: 6,
	});

	if (isLoading) {
		return (
			<div className="rounded-[var(--ct-radius)] border border-border bg-surface p-8 text-center text-sm text-fg-muted">
				Loading…
			</div>
		);
	}

	if (ids.length === 0) {
		return (
			<div className="rounded-[var(--ct-radius)] border border-border bg-surface p-10 text-center">
				<Inbox className="mx-auto size-8 text-fg-subtle" aria-hidden />
				<p className="mt-3 text-sm font-medium text-fg">
					{query.trim() || filter !== "all" ? "No torrents match" : "No torrents yet"}
				</p>
				<p className="mt-1 text-xs text-fg-muted">
					{query.trim() || filter !== "all"
						? "Try a different search or filter."
						: "Paste a magnet link, or drop a .torrent file above."}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="overflow-hidden rounded-[var(--ct-radius)] border border-border bg-surface">
				{/* Same ROW_GRID as the rows — that is what keeps them aligned. */}
				<div className={cn("hidden border-b border-border bg-surface-inset px-4 py-2 lg:block", ROW_GRID)}>
					{COLUMNS.map((h, i) => {
						const key = COLUMN_SORT[i];
						const active = key !== null && sort.key === key;
						const base = "text-[0.625rem] font-medium uppercase tracking-wide";

						if (!key) return <span key="actions" className={cn(base, "text-fg-subtle")} />;

						return (
							<button
								key={h}
								type="button"
								onClick={() => toggleSort(key)}
								// NOT aria-sort: that attribute is only valid on a columnheader,
								// and this header row is a CSS grid of buttons, not a real table.
								// Claiming it here is an invalid ARIA state; the label carries the
								// same information honestly.
								aria-label={active ? `${h}, sorted ${sort.dir}ending. Click to reverse.` : `Sort by ${h}`}
								className={cn(
									base,
									"inline-flex items-center gap-1 text-left transition-colors cursor-pointer",
									active ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
								)}
							>
								{h}
								{active &&
									(sort.dir === "asc" ? (
										<ArrowUp className="size-3" aria-hidden />
									) : (
										<ArrowDown className="size-3" aria-hidden />
									))}
							</button>
						);
					})}
				</div>

				<div
					ref={(el) => {
						parentRef.current = el;
						scrollToTop.current = el;
					}}
					className="max-h-[calc(100dvh-26rem)] overflow-auto"
				>
					<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
						{virtualizer.getVirtualItems().map((item) => (
							<div
								key={ids[item.index]}
								data-index={item.index}
								ref={virtualizer.measureElement}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${item.start}px)`,
								}}
							>
								<TorrentRow id={ids[item.index]} />
							</div>
						))}
					</div>
				</div>
			</div>

			<Pagination total={total} page={pageIndex} pageSize={pageSize} onPage={changePage} onPageSize={onPageSize} />
		</div>
	);
}
