"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowDownWideNarrow,
	ArrowUp,
	ArrowUpNarrowWide,
	Check,
	ChevronRight,
	CloudCheck,
	CloudOff,
	Copy,
	Download,
	EllipsisVertical,
	File,
	FileAudio,
	FileImage,
	FileText,
	FileType,
	FileVideo,
	Folder,
	FolderUp,
	HardDrive,
	LayoutGrid,
	List,
	LoaderCircle,
	Play,
	Share2,
	Subtitles,
	Trash2,
} from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { UploadToRemote } from "@/components/files/UploadToRemote";
import { CreateShareDialog } from "@/components/share/CreateShareDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { api, type BrowseEntry, type Upload } from "@/lib/api";
import { asAttachment } from "@/lib/attachment";
import { cn } from "@/lib/cn";
import { DEFAULT_DIR, FILE_SORT_LABELS, type FileSortKey, type SortDir, sortEntries, typeLabel } from "@/lib/fileSort";
import { formatBytes, formatClock, formatSince } from "@/lib/format";
import { classify, isDocument, resolve } from "@/lib/media";
import { useCopy } from "@/lib/useCopy";
import { latestByPath, useUploads } from "@/lib/useUploads";
import { MediaPlayerDialog } from "./MediaPlayerDialog";

const VIDEO = /\.(mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv)$/i;
const AUDIO = /\.(mp3|flac|aac|ogg|wav|m4a|opus)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
const SUBS = /\.(srt|vtt|ass|ssa|sub)$/i;

function iconFor(entry: BrowseEntry) {
	if (entry.type === "dir") return Folder;
	if (VIDEO.test(entry.name)) return FileVideo;
	if (AUDIO.test(entry.name)) return FileAudio;
	if (IMAGE.test(entry.name)) return FileImage;
	if (SUBS.test(entry.name)) return Subtitles;
	const { kind } = classify(entry.name);
	if (kind === "pdf") return FileType;
	if (kind === "text") return FileText;
	return File;
}

// Size and colour stay out of the base: cn() joins without resolving
// conflicts, so a variant that re-set them would depend on stylesheet order.
const ICON_BASE =
	"grid cursor-pointer place-items-center rounded-[var(--ct-radius-sm)] transition-colors disabled:pointer-events-none disabled:opacity-50";
const ICON_BUTTON = cn(ICON_BASE, "size-7 text-fg-subtle hover:bg-surface-inset hover:text-accent");

/**
 * The thumbnail route, authenticated by the access cookie like any GET. The
 * mtime in the URL is what lets the browser keep it for a week: a changed
 * file is a different URL.
 */
const thumbUrl = (entry: BrowseEntry) =>
	`/api/v1/files/browse/thumb?path=${encodeURIComponent(entry.path)}&v=${Date.parse(entry.modifiedAt)}`;

type ViewMode = "list" | "grid";
const VIEW_KEY = "ct-files-view";

/**
 * List or grid is a preference, like the sidebar's collapse: remembered by
 * this browser rather than carried in a link. Read after mount, so the server
 * render and the first client render agree.
 */
function useViewMode(): [ViewMode, (v: ViewMode) => void] {
	const [view, setView] = useState<ViewMode>("list");
	useEffect(() => {
		try {
			if (localStorage.getItem(VIEW_KEY) === "grid") setView("grid");
		} catch {
			/* storage blocked: the default stands */
		}
	}, []);
	const choose = (v: ViewMode) => {
		setView(v);
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			/* still applies for this visit */
		}
	};
	return [view, choose];
}

/** Close a popover on an outside click or Escape, like ColumnMenu. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: `close` is a fresh closure each render; `open` is the trigger
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, ref]);
}

function Breadcrumbs({ path, onNavigate, root }: { path: string; onNavigate: (p: string) => void; root: string }) {
	const parts = path ? path.split("/") : [];

	return (
		<nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
			<button
				type="button"
				onClick={() => onNavigate("")}
				className={cn(
					"inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--ct-radius-sm)] px-2 py-1",
					"transition-colors hover:bg-surface-2",
					parts.length === 0 ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
				)}
			>
				<HardDrive className="size-3.5" aria-hidden />
				{root}
			</button>

			{parts.map((part, i) => {
				const target = parts.slice(0, i + 1).join("/");
				const last = i === parts.length - 1;
				return (
					<span key={target} className="flex items-center gap-1">
						<ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
						<button
							type="button"
							onClick={() => onNavigate(target)}
							aria-current={last ? "page" : undefined}
							className={cn(
								"max-w-52 cursor-pointer truncate rounded-[var(--ct-radius-sm)] px-2 py-1",
								"transition-colors hover:bg-surface-2",
								last ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
							)}
						>
							{part}
						</button>
					</span>
				);
			})}
		</nav>
	);
}

/**
 * Whether this path is on storage, on its way there, or failed getting there.
 *
 * Answers "what have I already transferred?" where the question is actually
 * asked — in the browser, next to the file — instead of by eye against the
 * remote's own listing on another page.
 *
 * Icon always, words only when there is room: this sits in a row that already
 * drops two columns on a phone. `compact` is the grid's version: icon only,
 * no reserved column.
 */
function TransferBadge({ upload, compact = false }: { upload?: Upload; compact?: boolean }) {
	const spacer = compact ? null : <span className="w-0 shrink-0 md:w-24" aria-hidden />;
	if (!upload || upload.status === "cancelled") return spacer;

	const { status, remoteName } = upload;
	const live = status === "queued" || status === "running";
	const label = live ? (status === "queued" ? "Queued" : "Sending") : status === "completed" ? remoteName : "Failed";
	const title =
		status === "failed"
			? (upload.error ?? `Transfer to ${remoteName} failed`)
			: status === "completed"
				? `On ${remoteName}`
				: `${label} — ${remoteName}`;

	return (
		<span
			title={title}
			className={cn(
				"flex shrink-0 items-center justify-end gap-1 text-xs",
				!compact && "w-auto md:w-24",
				status === "failed" ? "text-status-errored" : status === "completed" ? "text-status-completed" : "text-accent",
			)}
		>
			{live ? (
				<LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
			) : status === "failed" ? (
				<CloudOff className="size-3.5 shrink-0" aria-hidden />
			) : (
				<CloudCheck className="size-3.5 shrink-0" aria-hidden />
			)}
			{!compact && <span className="hidden truncate md:inline">{label}</span>}
		</span>
	);
}

/** Everything one file or folder can do, shared by its list row and its grid tile. */
function useEntry(entry: BrowseEntry, onDeleted: () => void) {
	const isDir = entry.type === "dir";
	const { copied, copy } = useCopy();
	const [hint, setHint] = useState<string | null>(null);
	const [playing, setPlaying] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [sharing, setSharing] = useState(false);
	const media = resolve(entry.name, entry.playback);

	// One request serves both actions. Folders mint a zip link and files a direct
	// one; only the two fields both shapes share are used here, so narrow to
	// those rather than making the callers branch.
	const mintLink = async (): Promise<{ path: string; url: string }> =>
		isDir ? api.browseZipLink(entry.path) : api.browseLink(entry.path);

	const download = useMutation({
		mutationFn: mintLink,
		onSuccess: (link) => {
			window.open(asAttachment(link.path), "_blank", "noopener");
			if (isDir) setHint("Zipping — the download starts as soon as the first bytes are ready.");
		},
	});

	const remove = useMutation({
		mutationFn: () => api.deleteBrowsePath(entry.path),
		onSuccess: () => {
			setConfirming(false);
			onDeleted();
		},
	});

	const copyLink = useMutation({
		mutationFn: mintLink,
		onSuccess: (link) => copy(asAttachment(link.url)),
	});

	return {
		isDir,
		media,
		copied,
		hint,
		playing,
		setPlaying,
		confirming,
		setConfirming,
		sharing,
		setSharing,
		download,
		remove,
		copyLink,
		busy: download.isPending || copyLink.isPending,
		/** Has a player or reader behind it. */
		canOpen: !isDir && (media.viewable || media.needsExternalPlayer),
	};
}

type EntryState = ReturnType<typeof useEntry>;

function EntryActions({ entry, x, className }: { entry: BrowseEntry; x: EntryState; className?: string }) {
	return (
		<span className={cn("flex shrink-0 justify-end gap-0.5", className)}>
			{x.canOpen && (
				<button
					type="button"
					onClick={() => x.setPlaying(true)}
					aria-label={`${isDocument(x.media.kind) ? "View" : "Play"} ${entry.name}`}
					title={
						isDocument(x.media.kind) ? "Read it here" : x.media.needsExternalPlayer ? "Preview (may need VLC)" : "Play"
					}
					className={ICON_BUTTON}
				>
					{isDocument(x.media.kind) ? (
						<FileText className="size-3.5" aria-hidden />
					) : (
						<Play className="size-3.5" aria-hidden />
					)}
				</button>
			)}

			<button
				type="button"
				onClick={() => x.copyLink.mutate()}
				disabled={x.busy}
				aria-label={`Copy link to ${entry.name}`}
				title={x.copied ? "Copied" : x.isDir ? "Copy zip link" : "Copy download link"}
				className={ICON_BUTTON}
			>
				{x.copied ? (
					<Check className="size-3.5 text-status-completed" aria-hidden />
				) : (
					<Copy className="size-3.5" aria-hidden />
				)}
			</button>

			<button
				type="button"
				onClick={() => x.download.mutate()}
				disabled={x.busy}
				aria-label={`Download ${entry.name}`}
				title={x.isDir ? "Download folder as a zip" : "Download"}
				className={ICON_BUTTON}
			>
				{x.busy ? (
					<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
				) : (
					<Download className="size-3.5" aria-hidden />
				)}
			</button>

			<UploadToRemote path={entry.path} name={entry.name} />

			{entry.fileId && (
				<button
					type="button"
					onClick={() => x.setSharing(true)}
					aria-label={`Share ${entry.name}`}
					title="Create a share link"
					className={ICON_BUTTON}
				>
					<Share2 className="size-3.5" aria-hidden />
				</button>
			)}

			<button
				type="button"
				onClick={() => x.setConfirming(true)}
				disabled={x.busy || x.remove.isPending}
				aria-label={`Delete ${entry.name}`}
				title="Delete"
				className={cn(ICON_BASE, "size-7 text-fg-subtle hover:bg-surface-inset hover:text-danger")}
			>
				{x.remove.isPending ? (
					<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
				) : (
					<Trash2 className="size-3.5" aria-hidden />
				)}
			</button>
		</span>
	);
}

/**
 * Rendered by the row or tile itself, never inside the grid's popover: a
 * dialog is in the top layer, so a click in it counts as outside the popover,
 * which would close the popover and unmount the dialog with it.
 */
function EntryDialogs({ entry, x }: { entry: BrowseEntry; x: EntryState }) {
	return (
		<>
			{entry.fileId && (
				<CreateShareDialog
					open={x.sharing}
					onClose={() => x.setSharing(false)}
					fileId={entry.fileId}
					defaultLabel={entry.name}
					sizeBytes={entry.sizeBytes}
				/>
			)}

			<ConfirmDialog
				open={x.confirming}
				onClose={() => x.setConfirming(false)}
				onConfirm={() => x.remove.mutate()}
				busy={x.remove.isPending}
				danger
				confirmLabel="Delete"
				title={x.isDir ? "Delete this folder?" : "Delete this file?"}
				description={entry.name}
			>
				<p className="text-sm text-fg-muted">
					{x.isDir
						? "The folder and everything inside it is removed from disk. This cannot be undone."
						: "The file is removed from disk. This cannot be undone."}{" "}
					If a torrent is still seeding these files it will error or start fetching them again — remove the torrent
					first if you want it gone for good.
				</p>
				{x.remove.isError && (
					<p className="mt-2 text-sm text-status-errored">
						{x.remove.error instanceof Error && x.remove.error.message
							? x.remove.error.message
							: "Could not delete that."}
					</p>
				)}
			</ConfirmDialog>

			{!x.isDir && (
				<MediaPlayerDialog
					open={x.playing}
					onClose={() => x.setPlaying(false)}
					name={entry.name}
					playback={entry.playback}
					durationSeconds={entry.durationSeconds}
					check={entry.playbackCheck}
					getLink={() => api.browseLink(entry.path)}
				/>
			)}
		</>
	);
}

interface EntryProps {
	entry: BrowseEntry;
	/** The latest transfer of this path to storage, if there has been one. */
	upload?: Upload;
	onOpen: (p: string) => void;
	onDeleted: () => void;
}

function Row({ entry, upload, onOpen, onDeleted }: EntryProps) {
	const x = useEntry(entry, onDeleted);
	const Icon = iconFor(entry);

	return (
		<li className="border-b border-border last:border-b-0 hover:bg-surface-2">
			<div className="flex items-center gap-3 px-3 py-2.5">
				<Icon className={cn("size-4 shrink-0", x.isDir ? "text-accent" : "text-fg-subtle")} aria-hidden />

				{x.isDir || x.canOpen ? (
					<button
						type="button"
						onClick={() => (x.isDir ? onOpen(entry.path) : x.setPlaying(true))}
						className={cn(
							"min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:underline",
							x.isDir ? "text-fg" : "text-fg-muted hover:text-fg",
						)}
						title={entry.name}
					>
						{entry.name}
					</button>
				) : (
					<span className="min-w-0 flex-1 truncate text-sm text-fg-muted" title={entry.name}>
						{entry.name}
					</span>
				)}

				<TransferBadge upload={upload} />

				<span className="hidden w-28 shrink-0 truncate text-xs text-fg-subtle lg:block">{typeLabel(entry)}</span>
				<span className="tabular hidden w-24 shrink-0 text-right text-xs text-fg-subtle sm:block">
					{x.isDir ? "folder" : formatBytes(entry.sizeBytes)}
				</span>
				<span className="hidden w-24 shrink-0 text-right text-xs text-fg-subtle md:block">
					{formatSince(entry.modifiedAt)}
				</span>

				{/* Fixed width, right-aligned: Play is conditional, and without a
				    reserved slot its absence dragged the size and time columns 30px
				    left on every non-playable row. 6 x size-7 + 5 x gap-0.5 = 11.125rem. */}
				<EntryActions entry={entry} x={x} className="w-[11.125rem]" />
			</div>

			<EntryDialogs entry={entry} x={x} />

			{x.hint && (
				<p className="px-3 pb-2.5 text-[0.6875rem] text-fg-subtle">
					{x.hint} A zip cannot be resumed, so keep the tab open until it finishes.
				</p>
			)}
		</li>
	);
}

/** Column headers for the list. They sort, as in any file manager; the toolbar sorts the grid. */
function ListHeader({ sort, dir, onSort }: { sort: FileSortKey; dir: SortDir; onSort: (k: FileSortKey) => void }) {
	const column = (key: FileSortKey, className: string) => (
		<button
			type="button"
			onClick={() => onSort(key)}
			aria-label={`Sort by ${FILE_SORT_LABELS[key].toLowerCase()}`}
			className={cn(
				"cursor-pointer items-center gap-1 transition-colors hover:text-fg",
				sort === key && "text-fg",
				className,
			)}
		>
			{FILE_SORT_LABELS[key]}
			{sort === key &&
				(dir === "asc" ? (
					<ArrowUp className="size-3 shrink-0" aria-hidden />
				) : (
					<ArrowDown className="size-3 shrink-0" aria-hidden />
				))}
		</button>
	);

	// The same widths, in the same order, as Row — or the headers drift from
	// their own data.
	return (
		<div className="hidden items-center gap-3 border-b border-border px-3 py-1.5 text-[0.6875rem] font-medium text-fg-subtle sm:flex">
			<span className="size-4 shrink-0" aria-hidden />
			{column("name", "flex min-w-0 flex-1 justify-start")}
			<span className="w-0 shrink-0 md:w-24" aria-hidden />
			{column("type", "hidden w-28 shrink-0 justify-start lg:flex")}
			{column("size", "flex w-24 shrink-0 justify-end")}
			{column("modified", "hidden w-24 shrink-0 justify-end md:flex")}
			<span className="w-[11.125rem] shrink-0" aria-hidden />
		</div>
	);
}

/**
 * A grid tile. Clicking it does what double-clicking does in a file manager:
 * a folder opens, a file plays or reads. Anything else opens its actions,
 * because a click that silently starts a 20 GB download is not an open.
 */
function Tile({ entry, upload, onOpen, onDeleted }: EntryProps) {
	const x = useEntry(entry, onDeleted);
	const toast = useToast();
	const Icon = iconFor(entry);
	const [menu, setMenu] = useState(false);
	const [thumb, setThumb] = useState<"loading" | "shown" | "failed">("loading");
	const ref = useRef<HTMLLIElement>(null);
	useDismiss(menu, ref, () => setMenu(false));

	// The list shows this under the row; a tile has no room for a paragraph.
	useEffect(() => {
		if (x.hint) toast(`${x.hint} Keep the tab open until it finishes.`);
	}, [x.hint, toast]);

	const activate = () => {
		if (x.isDir) onOpen(entry.path);
		else if (x.canOpen) x.setPlaying(true);
		else setMenu(true);
	};

	const duration = x.media.kind === "video" && entry.durationSeconds ? formatClock(entry.durationSeconds) : null;

	return (
		<li
			ref={ref}
			className={cn("group relative rounded-[var(--ct-radius)] hover:bg-surface-2", menu && "bg-surface-2")}
		>
			<button
				type="button"
				onClick={activate}
				title={entry.name}
				className="flex w-full cursor-pointer flex-col gap-1.5 rounded-[var(--ct-radius)] p-2 text-left"
			>
				<span className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[var(--ct-radius-sm)] bg-surface-inset">
					<Icon
						className={cn("size-10", x.isDir ? "text-accent" : "text-fg-subtle", thumb === "shown" && "invisible")}
						aria-hidden
					/>
					{entry.thumbnail && thumb !== "failed" && (
						// biome-ignore lint/performance/noImgElement: a cookie-authenticated API route, which next/image cannot fetch
						<img
							src={thumbUrl(entry)}
							alt=""
							loading="lazy"
							decoding="async"
							onLoad={() => setThumb("shown")}
							onError={() => setThumb("failed")}
							className={cn(
								"absolute inset-0 size-full object-cover transition-opacity duration-200",
								thumb === "shown" ? "opacity-100" : "opacity-0",
							)}
						/>
					)}
					{duration && (
						<span className="tabular absolute right-1 bottom-1 rounded-[var(--ct-radius-sm)] bg-media-badge px-1 py-0.5 text-[0.625rem] font-medium text-media-badge-fg">
							{duration}
						</span>
					)}
				</span>
				<span className="line-clamp-2 break-words text-xs leading-snug text-fg">{entry.name}</span>
				<span className="flex items-center gap-1.5 text-[0.6875rem] text-fg-subtle">
					<span className="tabular truncate">{x.isDir ? "Folder" : formatBytes(entry.sizeBytes)}</span>
					<TransferBadge upload={upload} compact />
				</span>
			</button>

			<button
				type="button"
				onClick={() => setMenu((v) => !v)}
				aria-label={`Actions for ${entry.name}`}
				aria-expanded={menu}
				aria-haspopup="true"
				className={cn(
					"absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
					"bg-surface text-fg-muted shadow-[var(--ct-shadow)] transition-opacity hover:text-fg",
					// Revealed on hover where there is hover. Touch has none, so there
					// it stays visible; a keyboard reaches it through focus.
					!menu &&
						"[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100",
				)}
			>
				<EllipsisVertical className="size-4" aria-hidden />
			</button>

			{menu && (
				<div className="absolute top-11 right-2 z-20 rounded-[var(--ct-radius)] border border-border bg-surface p-1 shadow-[var(--ct-shadow-lg)]">
					<EntryActions entry={entry} x={x} />
				</div>
			)}

			<EntryDialogs entry={entry} x={x} />
		</li>
	);
}

function ViewControls({
	view,
	onView,
	sort,
	dir,
	onSort,
}: {
	view: ViewMode;
	onView: (v: ViewMode) => void;
	sort: FileSortKey;
	dir: SortDir;
	onSort: (key: FileSortKey, dir: SortDir) => void;
}) {
	const toggle = (v: ViewMode, label: string, Icon: typeof List) => (
		<button
			type="button"
			onClick={() => onView(v)}
			aria-pressed={view === v}
			aria-label={label}
			title={label}
			className={cn(
				"grid size-7 cursor-pointer place-items-center rounded-[calc(var(--ct-radius-sm)-2px)] transition-colors",
				view === v ? "bg-surface-2 text-fg" : "text-fg-subtle hover:text-fg",
			)}
		>
			<Icon className="size-4" aria-hidden />
		</button>
	);

	return (
		<div className="flex shrink-0 items-center gap-1.5">
			<label className="flex items-center">
				<span className="sr-only">Sort by</span>
				<select
					value={sort}
					onChange={(e) => {
						const key = e.target.value as FileSortKey;
						onSort(key, DEFAULT_DIR[key]);
					}}
					className={cn(
						"h-8 cursor-pointer rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset px-2",
						"text-xs text-fg outline-none focus:border-accent",
					)}
				>
					{(Object.keys(FILE_SORT_LABELS) as FileSortKey[]).map((key) => (
						<option key={key} value={key}>
							{FILE_SORT_LABELS[key]}
						</option>
					))}
				</select>
			</label>

			<button
				type="button"
				onClick={() => onSort(sort, dir === "asc" ? "desc" : "asc")}
				aria-label={dir === "asc" ? "Ascending — reverse it" : "Descending — reverse it"}
				title={dir === "asc" ? "Ascending" : "Descending"}
				className={cn(ICON_BASE, "size-8 border border-border text-fg-muted hover:bg-surface-2 hover:text-fg")}
			>
				{dir === "asc" ? (
					<ArrowUpNarrowWide className="size-4" aria-hidden />
				) : (
					<ArrowDownWideNarrow className="size-4" aria-hidden />
				)}
			</button>

			<fieldset className="flex rounded-[var(--ct-radius-sm)] border border-border p-0.5">
				<legend className="sr-only">View</legend>
				{toggle("list", "List view", List)}
				{toggle("grid", "Grid view", LayoutGrid)}
			</fieldset>
		</div>
	);
}

export function FileBrowser({
	path,
	onNavigate,
	sort,
	dir,
	onSort,
}: {
	path: string;
	onNavigate: (p: string) => void;
	sort: FileSortKey;
	dir: SortDir;
	onSort: (key: FileSortKey, dir: SortDir) => void;
}) {
	const [view, setView] = useViewMode();
	// Same query as the header indicator and the Storage panel, so a transfer
	// started here is marked here without a second poller.
	const transfers = latestByPath(useUploads().data);

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ["browse", path],
		queryFn: () => api.browse(path),
		// Folders change as torrents finish — fresh, but not chatty.
		refetchInterval: 15_000,
	});

	// The API returns one whole folder, so ordering it here costs nothing and
	// keeps a re-sort instant.
	const entries = useMemo(() => (data ? sortEntries(data.entries, sort, dir) : []), [data, sort, dir]);

	// A header clicked again reverses; a new one starts in its natural direction.
	const sortBy = (key: FileSortKey) => onSort(key, key === sort ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[key]);

	const props = (e: BrowseEntry) => ({
		entry: e,
		upload: transfers.get(e.path),
		onOpen: onNavigate,
		onDeleted: () => refetch(),
	});

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-2">
				<Breadcrumbs path={path} onNavigate={onNavigate} root={data?.root ?? "downloads"} />
				<ViewControls view={view} onView={setView} sort={sort} dir={dir} onSort={onSort} />
			</div>

			{isLoading && <p className="px-4 py-8 text-center text-sm text-fg-muted">Reading…</p>}

			{isError && (
				<p className="px-4 py-8 text-center text-sm text-status-errored">
					That folder could not be read. It may have been cleaned up.
				</p>
			)}

			{data && data.entries.length === 0 && data.parent === null && (
				<p className="px-4 py-10 text-center text-sm text-fg-muted">
					Nothing here yet — finished torrents appear automatically.
				</p>
			)}

			{data && (data.entries.length > 0 || data.parent !== null) && view === "list" && (
				<>
					<ListHeader sort={sort} dir={dir} onSort={sortBy} />
					<ul>
						{data.parent !== null && (
							<li className="border-b border-border px-3 py-2.5 hover:bg-surface-2">
								<button
									type="button"
									onClick={() => onNavigate(data.parent ?? "")}
									className="flex cursor-pointer items-center gap-3 text-sm text-fg-muted hover:text-fg"
								>
									<Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden />
									..
								</button>
							</li>
						)}
						{entries.map((e) => (
							<Row key={e.path} {...props(e)} />
						))}
					</ul>
				</>
			)}

			{data && (data.entries.length > 0 || data.parent !== null) && view === "grid" && (
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1 p-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:gap-2">
					{data.parent !== null && (
						<li className="rounded-[var(--ct-radius)] hover:bg-surface-2">
							<button
								type="button"
								onClick={() => onNavigate(data.parent ?? "")}
								title="Up one folder"
								className="flex w-full cursor-pointer flex-col gap-1.5 p-2 text-left"
							>
								<span className="grid aspect-[4/3] w-full place-items-center rounded-[var(--ct-radius-sm)] bg-surface-inset">
									<FolderUp className="size-10 text-fg-subtle" aria-hidden />
								</span>
								<span className="text-xs text-fg-muted">..</span>
							</button>
						</li>
					)}
					{entries.map((e) => (
						<Tile key={e.path} {...props(e)} />
					))}
				</ul>
			)}
		</section>
	);
}
