"use client";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Download, LoaderCircle, MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { classify } from "@/lib/media";
import { useCopy } from "@/lib/useCopy";

interface Link {
	path: string;
	url: string;
}

/**
 * Plays a file in place. Seeking works because Caddy serves the file with Range
 * support (verified in Phase 0) — a player without Range can only stream from
 * the beginning.
 *
 * The container extension is only a guess, so `onError` is treated as a normal
 * outcome, not a crash: an .mp4 holding HEVC will load and then fail, and the
 * honest answer at that point is VLC.
 */
export function MediaPlayerDialog({
	open,
	onClose,
	name,
	getLink,
}: {
	open: boolean;
	onClose: () => void;
	name: string;
	getLink: () => Promise<Link>;
}) {
	const media = classify(name);
	const { copied, copy } = useCopy();
	const [link, setLink] = useState<Link | null>(null);
	const [failed, setFailed] = useState(false);

	const load = useMutation({
		mutationFn: getLink,
		onSuccess: setLink,
	});

	useEffect(() => {
		if (open && !link && !load.isPending) load.mutate();
		if (!open) {
			setLink(null);
			setFailed(false);
		}
		// biome-ignore lint/correctness/useExhaustiveDependencies: mutate identity churns
	}, [open]);

	const fallback = (
		<div className="rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-4 text-center">
			<MonitorPlay className="mx-auto size-7 text-fg-subtle" aria-hidden />
			<p className="mt-2 text-sm font-medium text-fg">Your browser cannot play this one</p>
			<p className="mt-1 text-xs text-fg-muted">
				Usually an MKV, or HEVC video. Open the link in VLC — File → Open Network Stream — or download it.
			</p>
			{link && (
				<div className="mt-3 flex flex-wrap justify-center gap-2">
					<Button size="sm" variant="subtle" onClick={() => copy(link.url)}>
						{copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
						{copied ? "Copied" : "Copy stream URL"}
					</Button>
					<Button size="sm" variant="subtle" onClick={() => window.open(link.path, "_blank", "noopener")}>
						<Download className="size-3.5" aria-hidden />
						Download
					</Button>
				</div>
			)}
		</div>
	);

	return (
		<Dialog open={open} onClose={onClose} title={name} labelledBy="player-title">
			<div className="mt-4">
				{load.isPending && (
					<div className="grid h-40 place-items-center">
						<LoaderCircle className="size-5 animate-spin text-fg-subtle" aria-hidden />
					</div>
				)}

				{load.isError && <p className="text-sm text-status-errored">Could not create a playback link.</p>}

				{link && (failed || media.needsExternalPlayer) && fallback}

				{link && !failed && !media.needsExternalPlayer && (
					<>
						{media.kind === "video" && (
							// biome-ignore lint/a11y/useMediaCaption: .srt is not WebVTT; subtitles need conversion (Phase 8)
							<video
								src={link.path}
								controls
								autoPlay
								playsInline
								onError={() => setFailed(true)}
								className="max-h-[60vh] w-full rounded-[var(--ct-radius-sm)] bg-black"
							/>
						)}

						{media.kind === "audio" && (
							// biome-ignore lint/a11y/useMediaCaption: audio needs no captions here
							<audio src={link.path} controls autoPlay onError={() => setFailed(true)} className="w-full" />
						)}

						{media.kind === "image" && (
							<img
								src={link.path}
								alt={name}
								onError={() => setFailed(true)}
								className="mx-auto max-h-[60vh] rounded-[var(--ct-radius-sm)] object-contain"
							/>
						)}
					</>
				)}
			</div>

			<div className={cn("mt-4 flex flex-wrap items-center gap-2", "justify-end")}>
				{link && !failed && !media.needsExternalPlayer && (
					<Button size="sm" variant="ghost" onClick={() => copy(link.url)} title="Copy a direct stream URL">
						{copied ? <Check className="size-3.5 text-status-completed" /> : <Copy className="size-3.5" />}
						{copied ? "Copied" : "Copy URL"}
					</Button>
				)}
				<Button variant="subtle" onClick={onClose}>
					Close
				</Button>
			</div>
		</Dialog>
	);
}
