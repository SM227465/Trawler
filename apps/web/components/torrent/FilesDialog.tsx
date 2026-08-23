"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, LoaderCircle, Play, Share2, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CreateShareDialog } from "@/components/share/CreateShareDialog";
import { MediaPlayerDialog } from "@/components/files/MediaPlayerDialog";
import { classify } from "@/lib/media";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { api, type DownloadLink, type TorrentFile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatPercent } from "@/lib/format";
import { useCopy } from "@/lib/useCopy";

const basename = (p: string) => p.split("/").pop() ?? p;

function FileRow({ file }: { file: TorrentFile }) {
	const link = useMutation({ mutationFn: () => api.fileLink(file.id) });
	const url = useCopy();
	const cmd = useCopy();
	const [shown, setShown] = useState<DownloadLink | null>(null);
	const [shareOpen, setShareOpen] = useState(false);
	const [playing, setPlaying] = useState(false);
	const media = classify(basename(file.path));

	// One request serves all three actions: the token is the same either way.
	const withLink = async (use: (l: DownloadLink) => void) => {
		const l = shown ?? (await link.mutateAsync());
		setShown(l);
		use(l);
	};

	if (!file.isComplete) {
		return (
			<li className="border-b border-border px-1 py-3 last:border-b-0">
				<div className="flex items-baseline gap-2">
					<span className="min-w-0 flex-1 truncate text-sm text-fg-muted" title={file.path}>
						{basename(file.path)}
					</span>
					<span className="tabular shrink-0 text-xs text-fg-subtle">{formatBytes(file.sizeBytes)}</span>
				</div>
				<div className="mt-2 flex items-center gap-2">
					<ProgressBar value={file.progress} status="downloading" className="flex-1" />
					<span className="tabular w-11 shrink-0 text-right text-[0.6875rem] text-fg-subtle">
						{formatPercent(file.progress)}
					</span>
				</div>
			</li>
		);
	}

	return (
		<li className="border-b border-border px-1 py-3 last:border-b-0">
			<div className="flex items-baseline gap-2">
				<span className="min-w-0 flex-1 truncate text-sm text-fg" title={file.path}>
					{basename(file.path)}
				</span>
				<span className="tabular shrink-0 text-xs text-fg-subtle">{formatBytes(file.sizeBytes)}</span>
			</div>

			<div className="mt-2 flex flex-wrap gap-2">
				{(media.playable || media.needsExternalPlayer) && (
					<Button size="sm" variant="subtle" onClick={() => setPlaying(true)} title="Play in the browser">
						<Play className="size-3.5" aria-hidden />
						Play
					</Button>
				)}

				<Button
					size="sm"
					variant="primary"
					disabled={link.isPending}
					onClick={() => withLink((l) => window.open(l.url, "_blank", "noopener"))}
				>
					{link.isPending ? (
						<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
					) : (
						<Download className="size-3.5" aria-hidden />
					)}
					Download
				</Button>

				<Button size="sm" variant="subtle" onClick={() => withLink((l) => url.copy(l.absoluteUrl))}>
					{url.copied ? (
						<Check className="size-3.5 text-status-completed" aria-hidden />
					) : (
						<Copy className="size-3.5" aria-hidden />
					)}
					{url.copied ? "Copied" : "Copy link"}
				</Button>

				<Button size="sm" variant="subtle" onClick={() => setShareOpen(true)} title="Create a public link">
					<Share2 className="size-3.5" aria-hidden />
					Share
				</Button>

				<Button
					size="sm"
					variant="subtle"
					title="16 parallel connections — typically 3–5× a browser download"
					onClick={() => withLink((l) => cmd.copy(l.aria2c))}
				>
					{cmd.copied ? (
						<Check className="size-3.5 text-status-completed" aria-hidden />
					) : (
						<Terminal className="size-3.5" aria-hidden />
					)}
					{cmd.copied ? "Copied" : "aria2c"}
				</Button>
			</div>

			{shown && (
				<p className="mt-2 text-[0.6875rem] text-fg-subtle">
					Link valid until {new Date(shown.expiresAt).toLocaleString()}
				</p>
			)}

			<MediaPlayerDialog
				open={playing}
				onClose={() => setPlaying(false)}
				name={basename(file.path)}
				getLink={async () => {
					const l = shown ?? (await link.mutateAsync());
					setShown(l);
					return { path: l.url, url: l.absoluteUrl };
				}}
			/>

			<CreateShareDialog
				open={shareOpen}
				onClose={() => setShareOpen(false)}
				fileId={file.id}
				defaultLabel={basename(file.path)}
				sizeBytes={file.sizeBytes}
			/>
		</li>
	);
}

export function FilesDialog({
	torrentId,
	torrentName,
	open,
	onClose,
}: {
	torrentId: string;
	torrentName: string;
	open: boolean;
	onClose: () => void;
}) {
	const { data: files, isLoading } = useQuery({
		queryKey: ["torrent-files", torrentId],
		queryFn: () => api.torrentFiles(torrentId),
		enabled: open,
	});

	return (
		<Dialog open={open} onClose={onClose} title="Files" description={torrentName}>
			<div className={cn("mt-4 max-h-[50vh] overflow-y-auto", isLoading && "min-h-24")}>
				{isLoading && (
					<div className="grid h-24 place-items-center">
						<LoaderCircle className="size-5 animate-spin text-fg-subtle" aria-hidden />
					</div>
				)}
				{files && files.length === 0 && (
					<p className="py-6 text-center text-sm text-fg-muted">
						No files yet — metadata is still being fetched.
					</p>
				)}
				{files && files.length > 0 && (
					<ul>
						{[...files]
							.sort((a, b) => b.sizeBytes - a.sizeBytes)
							.map((f) => (
								<FileRow key={f.id} file={f} />
							))}
					</ul>
				)}
			</div>

			<div className="mt-5 flex justify-end">
				<Button variant="subtle" onClick={onClose}>
					Close
				</Button>
			</div>
		</Dialog>
	);
}
