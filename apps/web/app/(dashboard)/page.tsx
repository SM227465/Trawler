"use client";
import { Plus } from "lucide-react";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/nav/PageHeader";
import { AddTorrentDialog } from "@/components/torrent/AddTorrentDialog";
import { DEFAULT_SORT, type SortDir, type SortKey } from "@/components/torrent/sort";
import { type FilterValue, Toolbar } from "@/components/torrent/Toolbar";
import { TorrentList } from "@/components/torrent/TorrentList";
import { useColumns } from "@/components/torrent/useColumns";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/useDebounced";
import { useTorrentIndex, useTorrentStream } from "@/lib/useTorrentStream";
import { useUrlState } from "@/lib/useUrlState";

/** Every view parameter lives here, and therefore in the URL. */
const DEFAULTS = {
	q: "",
	status: "all",
	sort: DEFAULT_SORT.key as string,
	dir: DEFAULT_SORT.dir as string,
	page: 1,
	size: 50,
};

function TransfersView() {
	const { connected } = useTorrentStream(true);
	const [url, setUrl] = useUrlState(DEFAULTS);
	const [addOpen, setAddOpen] = useState(false);

	const debouncedQuery = useDebounced(url.q, 200);
	const index = useTorrentIndex();
	// Held here because two children need the same set: the toolbar owns the
	// menu, the list owns the grid it describes.
	const { hidden, toggle, reset } = useColumns();

	return (
		// h-full, not min-h-dvh: the shell already owns the viewport, and the list
		// below claims whatever this column has left over.
		<div className="flex h-full flex-col gap-4 sm:gap-5">
			<div className="flex flex-wrap items-start gap-3">
				<PageHeader title="Transfers" />

				<span className="inline-flex items-center gap-1.5 pt-1 text-xs text-fg-subtle">
					<span
						className={cn(
							"size-1.5 rounded-full",
							connected ? "bg-status-completed" : "animate-pulse bg-status-paused",
						)}
						aria-hidden
					/>
					{connected ? "Live" : "Reconnecting…"}
				</span>

				<Button variant="primary" onClick={() => setAddOpen(true)} className="ml-auto">
					<Plus className="size-4" aria-hidden />
					Add torrents
				</Button>
			</div>

			<Toolbar
				query={url.q}
				onQuery={(q) => setUrl({ q, page: 1 })}
				filter={url.status as FilterValue}
				onFilter={(status) => setUrl({ status, page: 1 })}
				index={index}
				sort={{ key: url.sort as SortKey, dir: url.dir as SortDir }}
				onSort={(s) => setUrl({ sort: s.key, dir: s.dir })}
				hidden={hidden}
				onToggleColumn={toggle}
				onResetColumns={reset}
			/>

			<TorrentList
				hidden={hidden}
				query={debouncedQuery}
				filter={url.status as FilterValue}
				sort={{ key: url.sort as SortKey, dir: url.dir as SortDir }}
				onSort={(s) => setUrl({ sort: s.key, dir: s.dir })}
				page={url.page}
				pageSize={url.size}
				onPage={(page) => setUrl({ page })}
				onPageSize={(size) => setUrl({ size, page: 1 })}
			/>

			<AddTorrentDialog open={addOpen} onClose={() => setAddOpen(false)} />
		</div>
	);
}

export default function TransfersPage() {
	// useSearchParams needs a Suspense boundary above it during prerender.
	return (
		<Suspense fallback={<p className="text-sm text-fg-muted">Loading…</p>}>
			<TransfersView />
		</Suspense>
	);
}
