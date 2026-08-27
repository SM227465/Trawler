"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	Check,
	FolderOpen,
	Link2,
	LoaderCircle,
	Pause,
	Pin,
	PinOff,
	Play,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusChip } from "@/components/ui/StatusChip";
import { api, type Torrent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatEta, formatPercent, formatSince, formatSpeed, formatSwarm } from "@/lib/format";
import { buildMagnet, useCopy } from "@/lib/useCopy";
import { TORRENT_IDS_KEY, torrentKey } from "@/lib/useTorrentStream";
import { FilesDialog } from "./FilesDialog";
import { gridTemplate, ROW_GRID } from "./grid";

/**
 * Which tint the row fills with. Token utilities only — the `-soft` steps are
 * already validated against both themes, and they are pale enough that the row
 * text keeps its contrast on top of them.
 */
const FILL: Record<string, string> = {
	downloading: "bg-status-downloading-soft",
	completed: "bg-status-completed-soft",
	paused: "bg-status-paused-soft",
	errored: "bg-status-errored-soft",
	queued: "bg-status-queued-soft",
};

/** On mobile the label is shown above the value; on lg the column header carries it. */
function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("min-w-0", className)}>
			<div className="text-[0.625rem] uppercase tracking-wide text-fg-subtle lg:hidden">{label}</div>
			<div className="tabular truncate text-sm text-fg-muted">{children}</div>
		</div>
	);
}

/**
 * Subscribes to its OWN cache entry. A 1 Hz update to one torrent re-renders
 * this row and nothing else — the table never reconciles as a whole.
 */
export const TorrentRow = memo(function TorrentRow({ id, hidden }: { id: string; hidden: Set<string> }) {
	const qc = useQueryClient();
	const { data: t } = useQuery<Torrent>({ queryKey: torrentKey(id), queryFn: () => api.getTorrent(id) });

	const act = useMutation({
		mutationFn: (verb: "pause" | "resume" | "pin" | "unpin") => api.action(id, verb),
		onSuccess: (_r, verb) => {
			if (verb === "pin" || verb === "unpin") {
				qc.setQueryData<Torrent>(torrentKey(id), (p) => (p ? { ...p, pinned: verb === "pin" } : p));
			}
		},
	});

	const { copied, copy } = useCopy();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [filesOpen, setFilesOpen] = useState(false);
	const [deleteFiles, setDeleteFiles] = useState(true);

	const remove = useMutation({
		mutationFn: () => api.removeTorrent(id, deleteFiles),
		onSuccess: () => {
			setConfirmOpen(false);
			qc.setQueryData<string[]>(TORRENT_IDS_KEY, (prev) => prev?.filter((x) => x !== id) ?? []);
			qc.removeQueries({ queryKey: torrentKey(id) });
		},
	});

	if (!t) return null;

	// Magnet metadata not resolved yet: no name, no size, no files.
	const metaPending = t.qbtState === "metaDL" || (!t.name && t.sizeBytes === 0);
	// No complete copy in the swarm. THE reason a torrent sticks at 97%, and the
	// thing everyone assumes is a client bug.
	const incompleteSwarm = t.status === "downloading" && t.availability > 0 && t.availability < 1;

	const show = (col: string) => !hidden.has(col);

	const paused = t.status === "paused";
	const done = t.status === "completed";

	return (
		<div
			className={cn(
				// `relative` + `isolate` so the progress fill below can sit behind the
				// content without escaping the row or catching pointer events.
				// border-STRONG, not border: the row fill now runs edge to edge, and the
				// subtle divider was tuned to sit against bg-surface — between two
				// filled rows it disappeared entirely and adjacent completed torrents
				// merged into one block.
				"relative isolate border-b border-border-strong py-3 pr-3 last:border-b-0 hover:bg-surface-2 sm:pr-4",
				"flex flex-col gap-3 lg:gap-0",
				// A pinned torrent is protected from cleanup — worth seeing at a
				// glance, not only by hunting for the icon.
				t.pinned ? "border-l-2 border-l-accent pl-[calc(0.75rem-2px)] sm:pl-[calc(1rem-2px)]" : "pl-3 sm:pl-4",
				ROW_GRID,
			)}
			style={{ "--ct-cols": gridTemplate(hidden) } as React.CSSProperties}
		>
			{/* The row IS the progress bar (put.io style): a tinted fill grows from
			    the left across the whole row rather than a separate hairline. It is
			    `aria-hidden` because the real value is announced by the percentage
			    text and the status chip — a decorative div should not be read out.
			    -z-10 keeps it behind the content; pointer-events-none keeps the
			    buttons clickable. */}
			<div
				aria-hidden
				className={cn(
					// bottom-px, not inset-y-0: leaves the divider row uncovered so the
					// separator survives even where two fills meet.
					"pointer-events-none absolute bottom-px left-0 -z-10 transition-[width] duration-500",
					// A row-height fill reads as a tint across a 40px desktop row, but
					// the same rule on a ~350px mobile card floods it — a finished
					// paused torrent came out a solid amber block that looked like an
					// error state. Thin bar on mobile, full-height fill from lg.
					"h-1 lg:top-0 lg:h-auto",
					FILL[t.status] ?? "bg-status-queued-soft",
				)}
				style={{ width: `${Math.min(100, Math.max(0, t.progress * 100))}%` }}
			/>

			{/* name */}
			{/* Wraps on mobile so the name gets a full-width line of its own. It
			    used to share one 360px row with the status chip, the percentage and
			    up to two badges, which left the name about half the width — long
			    release names were cut before the title even started. Widening the
			    container beats truncating cleverly: any rule that strips a
			    "www.tracker.org - " prefix eventually eats a name that really began
			    that way. lg:flex-nowrap puts it all back on one row on desktop. */}
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 lg:flex-nowrap">
				<span className="flex w-full min-w-0 items-center gap-2 lg:w-auto lg:flex-1">
					{t.pinned && <Pin className="size-3 shrink-0 text-accent" aria-label="Pinned" />}
					<Link
						href={`/torrents/${id}`}
						className="truncate text-sm font-medium text-fg hover:underline"
						title={t.name}
					>
						{/* doc 04 §5.4: while a magnet resolves, qBittorrent has no name
						    yet. The infohash beats an empty row that reads as a bug. */}
						{metaPending ? <span className="font-mono text-xs">{t.infoHash.slice(0, 16)}…</span> : t.name}
					</Link>
				</span>
				<StatusChip status={t.status} detail={t.qbtState} />

				{metaPending && (
					<span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-fg-subtle">
						<LoaderCircle className="size-3 animate-spin" aria-hidden />
						fetching metadata
					</span>
				)}

				{incompleteSwarm && (
					<span
						className="shrink-0 rounded-full bg-status-paused-soft px-1.5 py-0.5 text-[0.6875rem] text-status-paused"
						title={`Availability ${t.availability.toFixed(2)} — no complete copy is reachable, so this cannot finish until a seed appears. Not a fault in Trawler.`}
					>
						no full copy
					</span>
				)}

				{t.status === "errored" && t.errorMessage && (
					<span className="min-w-0 shrink truncate text-[0.6875rem] text-status-errored" title={t.errorMessage}>
						{t.errorMessage}
					</span>
				)}
				{done ? (
					// ETA is meaningless once complete; how long it has sat idle is
					// what decides cleanup order, so show that instead.
					<span
						className="shrink-0 text-[0.6875rem] text-fg-subtle"
						title="Time since this torrent was last downloaded from — cleanup removes the least recently used first"
					>
						idle {formatSince(t.lastAccessedAt ?? t.completedAt)}
					</span>
				) : (
					<span className="tabular shrink-0 text-[0.6875rem] text-fg-subtle">{formatPercent(t.progress)}</span>
				)}
			</div>

			{/* metrics — 3-up grid on mobile, aligned columns on lg */}
			{/* w-fit, not full width: three equal columns stretched across a 360px
			    screen gave each value ~105px to sit in when it needs ~50, so the
			    numbers drifted apart with nothing between them. Shrinking to fit
			    packs them left and sizes the columns to their widest cell, while
			    grid-cols-3 keeps Size/Seeds/Peers aligned with Down/Up/ETA on the
			    row beneath — which content-sized columns would not. */}
			<div className="grid w-fit grid-cols-3 gap-x-5 gap-y-2 sm:w-auto sm:grid-cols-6 lg:contents">
				{show("Size") && <Cell label="Size">{t.sizeBytes > 0 ? formatBytes(t.sizeBytes) : "—"}</Cell>}
				{show("Seeds") && <Cell label="Seeds">{formatSwarm(t.seedsConnected, t.seedsTotal)}</Cell>}
				{show("Peers") && <Cell label="Peers">{formatSwarm(t.peersConnected, t.peersTotal)}</Cell>}

				{show("Down") && (
					<Cell label="Down">
						<span className="inline-flex items-center gap-1 text-chart-dl">
							<ArrowDown className="size-3 shrink-0" aria-hidden />
							{formatSpeed(t.dlSpeedBps)}
						</span>
					</Cell>
				)}

				{show("Up") && (
					<Cell label="Up">
						<span className="inline-flex items-center gap-1 text-chart-ul">
							<ArrowUp className="size-3 shrink-0" aria-hidden />
							{formatSpeed(t.upSpeedBps)}
						</span>
					</Cell>
				)}

				{show("ETA") && <Cell label="ETA">{done ? "—" : formatEta(t.etaSeconds)}</Cell>}
			</div>

			{/* actions */}
			<div className="flex items-center gap-1 lg:justify-end">
				<Button
					size="icon"
					variant="ghost"
					title="Files and download links"
					aria-label="Files and download links"
					onClick={() => setFilesOpen(true)}
				>
					<FolderOpen className="size-3.5" />
				</Button>

				<Button
					size="icon"
					variant="ghost"
					title={paused ? "Resume" : "Pause"}
					aria-label={paused ? "Resume" : "Pause"}
					disabled={act.isPending}
					onClick={() => act.mutate(paused ? "resume" : "pause")}
				>
					{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
				</Button>

				<Button
					size="icon"
					variant="ghost"
					title={copied ? "Copied" : "Copy magnet link"}
					aria-label="Copy magnet link"
					onClick={() => copy(buildMagnet(t.infoHash, t.name))}
				>
					{copied ? <Check className="size-3.5 text-status-completed" /> : <Link2 className="size-3.5" />}
				</Button>

				<Button
					size="icon"
					variant="ghost"
					aria-pressed={t.pinned}
					title={t.pinned ? "Pinned — protected from cleanup. Click to unpin." : "Pin to protect from cleanup"}
					aria-label={t.pinned ? "Unpin" : "Pin"}
					disabled={act.isPending}
					onClick={() => act.mutate(t.pinned ? "unpin" : "pin")}
					className={cn(t.pinned && "text-accent hover:text-accent")}
				>
					{t.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
				</Button>

				<Button
					size="icon"
					variant="ghost"
					title="Delete torrent and files"
					aria-label="Delete"
					disabled={remove.isPending}
					onClick={() => setConfirmOpen(true)}
					className="hover:text-danger"
				>
					<Trash2 className="size-3.5" />
				</Button>
			</div>

			<FilesDialog torrentId={id} torrentName={t.name} open={filesOpen} onClose={() => setFilesOpen(false)} />

			<ConfirmDialog
				open={confirmOpen}
				onClose={() => setConfirmOpen(false)}
				onConfirm={() => remove.mutate()}
				title="Remove torrent"
				description={t.name}
				confirmLabel={deleteFiles ? "Delete torrent and files" : "Remove from list"}
				danger
				busy={remove.isPending}
			>
				<Checkbox
					label="Also delete the downloaded files"
					hint={
						deleteFiles
							? `Frees ${formatBytes(t.sizeBytes)} on disk. This cannot be undone.`
							: "Files stay on disk; only the entry is removed."
					}
					checked={deleteFiles}
					onChange={(e) => setDeleteFiles(e.target.checked)}
				/>
			</ConfirmDialog>
		</div>
	);
});
