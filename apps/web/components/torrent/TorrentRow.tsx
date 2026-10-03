"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	Check,
	FolderOpen,
	Link2,
	Pause,
	Pin,
	Play,
	RefreshCw,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusChip } from "@/components/ui/StatusChip";
import { api, type Torrent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatAge, formatBytes, formatEta, formatPercent, formatSpeed, formatSwarm } from "@/lib/format";
import { availabilityOf, formatAvailability, isIncompleteSwarm } from "@/lib/swarm";
import { isPartialSelection, wantedBytes } from "@/lib/torrentSize";
import { buildMagnet, useCopy } from "@/lib/useCopy";
import { forgetTorrents, torrentKey } from "@/lib/useTorrentStream";
import { FilesDialog } from "./FilesDialog";
import { gridTemplate, ROW_GRID } from "./grid";

/**
 * Which tint the row fills with. Token utilities only — the `-soft` steps are
 * already validated against both themes, and they are pale enough that the row
 * text keeps its contrast on top of them.
 */
/**
 * Shared by the row and its loading placeholder, so both measure the same
 * height in the virtualizer.
 *
 * border-STRONG, not border: the row fill runs edge to edge, and the subtle
 * divider was tuned to sit against bg-surface — between two filled rows it
 * disappeared and adjacent completed torrents merged into one block.
 *
 * `relative` + `isolate` so the progress fill can sit behind the content
 * without escaping the row or catching pointer events.
 */
const ROW_SHELL =
	"relative isolate border-b border-border-strong py-3 pr-3 last:border-b-0 hover:bg-surface-2 sm:pr-4 flex flex-col gap-3 lg:gap-0";

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
		mutationFn: (verb: "pause" | "resume" | "recheck" | "pin" | "unpin") => api.action(id, verb),
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
			forgetTorrents(qc, [id]);
		},
	});

	// A placeholder, never null. The list is virtualized and measures each row's
	// wrapper with measureElement: a row that renders nothing measures 0px while
	// getTotalSize() still reserves its space, which is exactly the blank gap
	// that used to appear mid-list. Rows unmount and remount as they leave the
	// overscan window, so this happened intermittently rather than on load.
	if (!t) {
		return (
			<div
				className={cn(ROW_SHELL, "pl-3 sm:pl-4", ROW_GRID)}
				style={{ "--ct-cols": gridTemplate(hidden) } as React.CSSProperties}
				aria-hidden
			>
				<div className="h-4 w-2/3 animate-pulse rounded bg-surface-inset" />
			</div>
		);
	}

	// Magnet metadata not resolved yet: no name, no size, no files.
	const metaPending = t.qbtState === "metaDL" || t.qbtState === "forcedMetaDL" || (!t.name && t.sizeBytes === 0);
	const availability = availabilityOf(t);

	const show = (col: string) => !hidden.has(col);

	const paused = t.status === "paused";
	const done = t.status === "completed";

	return (
		<div
			className={cn(
				ROW_SHELL,
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

			{/* name — alone in its cell. Status, progress and availability each
			    have a column of their own; they used to follow the name inside
			    this cell, and every one of them came out of its width. */}
			<div className="flex min-w-0 items-center gap-2">
				{t.pinned && <Pin className="size-3 shrink-0 text-accent" aria-label="Pinned" />}
				<Link href={`/torrents/${id}`} className="truncate text-sm font-medium text-fg hover:underline" title={t.name}>
					{/* doc 04 §5.4: while a magnet resolves, qBittorrent has no name
					    yet. The infohash beats an empty row that reads as a bug. */}
					{metaPending ? <span className="font-mono text-xs">{t.infoHash.slice(0, 16)}…</span> : t.name}
				</Link>
			</div>

			{/* status — the chip, and the one note that goes with it. On a phone
			    -mt-2 keeps it tucked under the name, where it sat when the two
			    shared a cell; the card's gap-3 would otherwise open up between. */}
			{show("Status") && (
				<div className="-mt-2 flex min-w-0 items-center gap-2 lg:mt-0">
					<StatusChip status={t.status} detail={t.qbtState} />
					{t.status === "errored" && t.errorMessage ? (
						// doc 04 §5.4: qBittorrent's own message is the only thing that
						// says WHY. Cut to the column here, whole on hover.
						<span className="min-w-0 truncate text-[0.6875rem] text-status-errored" title={t.errorMessage}>
							{t.errorMessage}
						</span>
					) : done ? (
						// ETA is meaningless once complete; how long it has sat idle is
						// what decides cleanup order, so show that instead.
						<span
							className="shrink-0 text-[0.6875rem] text-fg-subtle"
							title="Time since this torrent was last downloaded from — cleanup removes the least recently used first"
						>
							idle {formatAge(t.lastAccessedAt ?? t.completedAt)}
						</span>
					) : metaPending ? null : (
						// Hidden while metadata resolves: it can only ever read 0.0%.
						<span className="tabular shrink-0 text-[0.6875rem] text-fg-subtle">{formatPercent(t.progress)}</span>
					)}
				</div>
			)}

			{/* metrics — 3-up grid on mobile, aligned columns on lg */}
			{/* w-fit, not full width: three equal columns stretched across a 360px
			    screen gave each value ~105px to sit in when it needs ~50, so the
			    numbers drifted apart with nothing between them. Shrinking to fit
			    packs them left and sizes the columns to their widest cell, while
			    grid-cols-3 keeps Size/Seeds/Peers aligned with Down/Up/ETA on the
			    row beneath — which content-sized columns would not. */}
			<div className="grid w-fit grid-cols-3 gap-x-5 gap-y-2 sm:w-auto sm:grid-cols-6 lg:contents">
				{show("Size") && (
					<Cell label="Size">
						{/* The size being FETCHED, as qBittorrent's own column shows it:
						    progress and ETA beside it are measured against this, not
						    against every file in the torrent. The total is a hover away,
						    and spelled out on the torrent's own page. */}
						{wantedBytes(t) > 0 || isPartialSelection(t) ? (
							<span
								title={
									isPartialSelection(t)
										? `${formatBytes(wantedBytes(t))} selected of ${formatBytes(t.sizeBytes)} — some files are skipped`
										: undefined
								}
							>
								{formatBytes(wantedBytes(t))}
							</span>
						) : (
							"—"
						)}
					</Cell>
				)}
				{show("Seeds") && <Cell label="Seeds">{formatSwarm(t.seedsConnected, t.seedsTotal)}</Cell>}
				{show("Peers") && <Cell label="Peers">{formatSwarm(t.peersConnected, t.peersTotal)}</Cell>}

				{/* After Peers on desktop, where the swarm columns sit together. Last
				    on a phone, so Size/Seeds/Peers still line up over Down/Up/ETA —
				    and only when there is a number: a card is not a grid, and a row
				    of its own reading "—" on every finished torrent is just height.
				    The desktop row keeps the cell regardless; the track needs it. */}
				{show("Availability") && (
					<Cell
						label="Availability"
						className={cn("order-last lg:order-none", availability === null && "hidden lg:block")}
					>
						{availability === null ? (
							"—"
						) : isIncompleteSwarm(availability) ? (
							<span
								className="inline-flex items-center gap-1 text-status-paused"
								title={`Only ${formatAvailability(availability)} of the file is available — from the connected peers and what is already on disk. The rest has no source, so this cannot finish until a peer that has it connects. Not a fault in Trawler.`}
							>
								<TriangleAlert className="size-3 shrink-0" aria-hidden />
								{formatAvailability(availability)}
								<span className="sr-only">
									{" "}
									of the file available — the rest has no source, so this cannot finish until a peer that has it
									connects
								</span>
							</span>
						) : (
							<span
								title={
									availability === 0
										? "Nothing available yet — no peers connected"
										: `The whole file is available — ${availability.toFixed(2)} copies among the connected peers`
								}
							>
								{formatAvailability(availability)}
							</span>
						)}
					</Cell>
				)}

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

			{/* actions
			    Pinning lives on the torrent's own page now. It is a rare, deliberate
			    act — protect this from cleanup — and it was costing every row a
			    button's width on a 1366px laptop, where the name is the column that
			    actually needs it. The pin still SHOWS here, beside the name. */}
			<div className="flex items-center gap-0.5 lg:justify-end">
				<Button
					size="icon"
					variant="ghost"
					title="Files and download links"
					aria-label="Files and download links"
					onClick={() => setFilesOpen(true)}
				>
					<FolderOpen className="size-3.5" />
				</Button>

				{/* Recheck: re-verify what is on disk against the torrent.
				    Shown only when errored, which is when it is the right answer —
				    a write that failed part-way (a full disk, most recently) leaves
				    pieces that will never validate, and rechecking discards exactly
				    those and carries on. The alternative was deleting 1.25 GB to
				    fix a handful of bad pieces. */}
				{t.status === "errored" && (
					<Button
						size="icon"
						variant="ghost"
						title="Re-check the downloaded data and resume"
						aria-label="Re-check this torrent"
						disabled={act.isPending}
						onClick={() => act.mutate("recheck")}
					>
						<RefreshCw className={cn("size-3.5", act.isPending && "animate-spin")} />
					</Button>
				)}

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
							? `Frees ${t.progress >= 1 ? "" : "up to "}${formatBytes(wantedBytes(t))} on disk. This cannot be undone.`
							: "Files stay on disk; only the entry is removed."
					}
					checked={deleteFiles}
					onChange={(e) => setDeleteFiles(e.target.checked)}
				/>
			</ConfirmDialog>
		</div>
	);
});
