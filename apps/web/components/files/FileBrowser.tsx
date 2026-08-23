"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	Check,
	ChevronRight,
	Copy,
	Download,
	File,
	FileAudio,
	FileImage,
	FileVideo,
	Folder,
	HardDrive,
	LoaderCircle,
	Play,
	Subtitles,
} from "lucide-react";
import { api, type BrowseEntry } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatSince } from "@/lib/format";
import { classify } from "@/lib/media";
import { useCopy } from "@/lib/useCopy";
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
	return File;
}

function Breadcrumbs({ path, onNavigate, root }: { path: string; onNavigate: (p: string) => void; root: string }) {
	const parts = path ? path.split("/") : [];

	return (
		<nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
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

function Row({ entry, onOpen }: { entry: BrowseEntry; onOpen: (p: string) => void }) {
	const Icon = iconFor(entry);
	const isDir = entry.type === "dir";
	const { copied, copy } = useCopy();
	const [hint, setHint] = useState<string | null>(null);
	const [playing, setPlaying] = useState(false);
	const media = classify(entry.name);

	// One request serves both actions. Folders mint a zip link and files a direct
	// one; only the two fields both shapes share are used here, so narrow to
	// those rather than making the callers branch.
	const mintLink = async (): Promise<{ path: string; url: string }> =>
		isDir ? api.browseZipLink(entry.path) : api.browseLink(entry.path);

	const download = useMutation({
		mutationFn: mintLink,
		onSuccess: (link) => {
			window.open(link.path, "_blank", "noopener");
			if (isDir) setHint("Zipping — the download starts as soon as the first bytes are ready.");
		},
	});

	const copyLink = useMutation({
		mutationFn: mintLink,
		onSuccess: (link) => copy(link.url),
	});

	const busy = download.isPending || copyLink.isPending;

	return (
		<li className="border-b border-border last:border-b-0 hover:bg-surface-2">
			<div className="flex items-center gap-3 px-3 py-2.5">
				<Icon className={cn("size-4 shrink-0", isDir ? "text-accent" : "text-fg-subtle")} aria-hidden />

				{isDir ? (
					<button
						type="button"
						onClick={() => onOpen(entry.path)}
						className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-fg hover:underline"
						title={entry.name}
					>
						{entry.name}
					</button>
				) : (
					<span className="min-w-0 flex-1 truncate text-sm text-fg-muted" title={entry.name}>
						{entry.name}
					</span>
				)}

				<span className="tabular hidden w-24 shrink-0 text-right text-xs text-fg-subtle sm:block">
					{isDir ? "folder" : formatBytes(entry.sizeBytes)}
				</span>
				<span className="hidden w-24 shrink-0 text-right text-xs text-fg-subtle md:block">
					{formatSince(entry.modifiedAt)}
				</span>

				<span className="flex shrink-0 gap-0.5">
					{!isDir && (media.playable || media.needsExternalPlayer) && (
						<button
							type="button"
							onClick={() => setPlaying(true)}
							aria-label={`Play ${entry.name}`}
							title={media.needsExternalPlayer ? "Preview (may need VLC)" : "Play"}
							className={cn(
								"grid size-7 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
								"text-fg-subtle transition-colors hover:bg-surface-inset hover:text-accent",
							)}
						>
							<Play className="size-3.5" aria-hidden />
						</button>
					)}

					<button
						type="button"
						onClick={() => copyLink.mutate()}
						disabled={busy}
						aria-label={`Copy link to ${entry.name}`}
						title={copied ? "Copied" : isDir ? "Copy zip link" : "Copy download link"}
						className={cn(
							"grid size-7 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
							"text-fg-subtle transition-colors hover:bg-surface-inset hover:text-accent",
							"disabled:pointer-events-none disabled:opacity-50",
						)}
					>
						{copied ? (
							<Check className="size-3.5 text-status-completed" aria-hidden />
						) : (
							<Copy className="size-3.5" aria-hidden />
						)}
					</button>

					<button
						type="button"
						onClick={() => download.mutate()}
						disabled={busy}
						aria-label={`Download ${entry.name}`}
						title={isDir ? "Download folder as a zip" : "Download"}
						className={cn(
							"grid size-7 cursor-pointer place-items-center rounded-[var(--ct-radius-sm)]",
							"text-fg-subtle transition-colors hover:bg-surface-inset hover:text-accent",
							"disabled:pointer-events-none disabled:opacity-50",
						)}
					>
						{busy ? (
							<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
						) : (
							<Download className="size-3.5" aria-hidden />
						)}
					</button>
				</span>
			</div>

			{!isDir && (
				<MediaPlayerDialog
					open={playing}
					onClose={() => setPlaying(false)}
					name={entry.name}
					getLink={() => api.browseLink(entry.path)}
				/>
			)}

			{hint && (
				<p className="px-3 pb-2.5 text-[0.6875rem] text-fg-subtle">
					{hint} A zip cannot be resumed, so keep the tab open until it finishes.
				</p>
			)}
		</li>
	);
}

export function FileBrowser({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
	const { data, isLoading, isError } = useQuery({
		queryKey: ["browse", path],
		queryFn: () => api.browse(path),
		// Folders change as torrents finish — fresh, but not chatty.
		refetchInterval: 15_000,
	});

	return (
		<section className="rounded-[var(--ct-radius)] border border-border bg-surface">
			<div className="border-b border-border px-2 py-2">
				<Breadcrumbs path={path} onNavigate={onNavigate} root={data?.root ?? "downloads"} />
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

			{data && (data.entries.length > 0 || data.parent !== null) && (
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
					{data.entries.map((e) => (
						<Row key={e.path} entry={e} onOpen={onNavigate} />
					))}
				</ul>
			)}
		</section>
	);
}
