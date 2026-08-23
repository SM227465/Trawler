"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, LoaderCircle, Play, Share2, Terminal } from "lucide-react";
import { useState } from "react";
import { MediaPlayerDialog } from "@/components/files/MediaPlayerDialog";
import { CreateShareDialog } from "@/components/share/CreateShareDialog";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { api, type DownloadLink, type TorrentFile } from "@/lib/api";
import { formatBytes, formatPercent } from "@/lib/format";
import { classify } from "@/lib/media";
import { useCopy } from "@/lib/useCopy";

const basename = (p: string) => p.split("/").pop() ?? p;

function FileRow({ file }: { file: TorrentFile }) {
	const link = useMutation({ mutationFn: () => api.fileLink(file.id) });
	const cmd = useCopy();
	const url = useCopy();
	const [shown, setShown] = useState<DownloadLink | null>(null);
	const [share, setShare] = useState(false);
	const [play, setPlay] = useState(false);
	const media = classify(basename(file.path));

	const withLink = async (use: (l: DownloadLink) => void) => {
		const l = shown ?? (await link.mutateAsync());
		setShown(l);
		use(l);
	};

	return (
		<li className="border-b border-border px-4 py-3 last:border-b-0">
			<div className="flex items-baseline gap-3">
				<span className="min-w-0 flex-1 truncate text-sm text-fg" title={file.path}>
					{file.path}
				</span>
				<span className="tabular shrink-0 text-xs text-fg-subtle">{formatBytes(file.sizeBytes)}</span>
			</div>

			{!file.isComplete && (
				<div className="mt-2 flex items-center gap-2">
					<ProgressBar value={file.progress} status="downloading" className="flex-1" />
					<span className="tabular w-11 text-right text-[0.6875rem] text-fg-subtle">
						{formatPercent(file.progress)}
					</span>
				</div>
			)}

			{file.isComplete && (
				<div className="mt-2 flex flex-wrap gap-2">
					{(media.playable || media.needsExternalPlayer) && (
						<Button size="sm" variant="subtle" onClick={() => setPlay(true)}>
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
					<Button size="sm" variant="subtle" onClick={() => setShare(true)}>
						<Share2 className="size-3.5" aria-hidden />
						Share
					</Button>
					<Button size="sm" variant="subtle" onClick={() => withLink((l) => url.copy(l.absoluteUrl))}>
						{url.copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
						{url.copied ? "Copied" : "Copy link"}
					</Button>
					<Button size="sm" variant="subtle" onClick={() => withLink((l) => cmd.copy(l.aria2c))}>
						{cmd.copied ? <Check className="size-3.5 text-status-completed" /> : <Terminal className="size-3.5" />}
						{cmd.copied ? "Copied" : "aria2c"}
					</Button>
				</div>
			)}

			<MediaPlayerDialog
				open={play}
				onClose={() => setPlay(false)}
				name={basename(file.path)}
				getLink={async () => {
					const l = shown ?? (await link.mutateAsync());
					setShown(l);
					return { path: l.url, url: l.absoluteUrl };
				}}
			/>
			<CreateShareDialog
				open={share}
				onClose={() => setShare(false)}
				fileId={file.id}
				defaultLabel={basename(file.path)}
				sizeBytes={file.sizeBytes}
			/>
		</li>
	);
}

export function DetailContent({ torrentId }: { torrentId: string }) {
	const { data: files, isLoading } = useQuery({
		queryKey: ["torrent-files", torrentId],
		queryFn: () => api.torrentFiles(torrentId),
		refetchInterval: 5000,
	});

	if (isLoading) return <p className="text-sm text-fg-muted">Loading files…</p>;
	if (!files || files.length === 0) {
		return (
			<p className="rounded-[var(--ct-radius)] border border-border bg-surface p-8 text-center text-sm text-fg-muted">
				No files yet — metadata is still being fetched.
			</p>
		);
	}

	return (
		<ul className="overflow-hidden rounded-[var(--ct-radius)] border border-border bg-surface">
			{[...files]
				.sort((a, b) => b.sizeBytes - a.sizeBytes)
				.map((f) => (
					<FileRow key={f.id} file={f} />
				))}
		</ul>
	);
}
