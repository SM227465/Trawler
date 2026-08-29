"use client";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Download, LoaderCircle, MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { asAttachment } from "@/lib/attachment";
import { cn } from "@/lib/cn";
import { classify } from "@/lib/media";
import { useCopy } from "@/lib/useCopy";

interface Link {
	path: string;
	url: string;
	/** The same token through ffmpeg. Only present for files that need it. */
	remuxPath?: string;
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
	playback,
	durationSeconds,
}: {
	open: boolean;
	onClose: () => void;
	name: string;
	getLink: () => Promise<Link>;
	/** ffprobe's verdict. Absent means unprobed — fall back to the extension. */
	playback?: "direct" | "remux" | "incompatible" | "not_media";
	durationSeconds?: number | null;
}) {
	const guess = classify(name);

	// The probe wins wherever it exists. An .mkv the guess calls unplayable may
	// be one rewrap away, and an .mp4 it calls playable may be HEVC.
	const media = playback
		? {
				...guess,
				playable: playback === "direct" || playback === "remux",
				needsExternalPlayer: playback === "incompatible",
			}
		: guess;

	const needsRemux = playback === "remux";
	// Fragmented MP4 carries no index, so the browser cannot byte-range seek it.
	// Seeking restarts the stream at an offset instead — this is the offset.
	const [startAt, setStartAt] = useState(0);
	const { copied, copy } = useCopy();
	const [link, setLink] = useState<Link | null>(null);
	const [failed, setFailed] = useState(false);

	const load = useMutation({
		mutationFn: getLink,
		onSuccess: setLink,
	});

	// This effect must fire on OPEN/CLOSE only. `load` is a TanStack mutation
	// whose identity changes on every state transition it makes, so including it
	// would re-enter the effect mid-request and refetch in a loop; `link` is the
	// thing the effect sets.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on `open`
	useEffect(() => {
		if (open && !link && !load.isPending) load.mutate();
		if (!open) {
			setLink(null);
			setFailed(false);
		}
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
					<Button size="sm" variant="subtle" onClick={() => window.open(asAttachment(link.path), "_blank", "noopener")}>
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
							<>
								{/* biome-ignore lint/a11y/useMediaCaption: .srt is not WebVTT; conversion is not built */}
								<video
									key={startAt}
									src={
										needsRemux && link.remuxPath ? `${link.remuxPath}${startAt > 0 ? `?t=${startAt}` : ""}` : link.path
									}
									controls
									autoPlay
									playsInline
									onError={() => setFailed(true)}
									className="max-h-[60vh] w-full rounded-[var(--ct-radius-sm)] bg-black"
								/>

								{needsRemux && (
									<RemuxSeek durationSeconds={durationSeconds ?? null} startAt={startAt} onSeek={setStartAt} />
								)}
							</>
						)}

						{media.kind === "audio" && (
							// biome-ignore lint/a11y/useMediaCaption: audio needs no captions here
							<audio src={link.path} controls autoPlay onError={() => setFailed(true)} className="w-full" />
						)}

						{media.kind === "image" && (
							// Plain <img>, not next/image. Next's own docs (Image ->
							// `src`): the Image Optimization API "will not forward headers
							// when fetching the src image... if the src image requires
							// authentication, consider using unoptimized". These are
							// token-authenticated /dl/ URLs for the user's OWN private
							// files, so optimisation is both impossible and undesirable —
							// it would route private bytes through the optimiser. With
							// `unoptimized` set, next/image adds only a width/height
							// requirement we cannot satisfy for arbitrary user files.
							// biome-ignore lint/performance/noImgElement: auth'd private media, optimisation disabled anyway
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

/**
 * Seeking for a converted stream.
 *
 * A fragmented MP4 has no index, so the browser's own scrubber can only move
 * within what it has already buffered — it cannot jump to minute 40 of a file
 * that is being produced as it plays. Restarting ffmpeg at an offset is how
 * that is done, and `key={startAt}` on the <video> forces a fresh element so
 * the browser actually re-requests rather than resuming its buffer.
 *
 * Shown only for remuxed video. Direct playback keeps the native scrubber,
 * which is better in every way when it works.
 */
function RemuxSeek({
	durationSeconds,
	startAt,
	onSeek,
}: {
	durationSeconds: number | null;
	startAt: number;
	onSeek: (s: number) => void;
}) {
	const [pending, setPending] = useState(startAt);

	const fmt = (s: number) => {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = Math.floor(s % 60);
		return h > 0
			? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
			: `${m}:${String(sec).padStart(2, "0")}`;
	};

	if (!durationSeconds || durationSeconds <= 0) {
		return (
			<p className="mt-2 text-xs text-fg-subtle">
				This file is being converted as it plays, so the scrubber only moves within what has loaded.
			</p>
		);
	}

	return (
		<div className="mt-2 flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<input
					type="range"
					min={0}
					max={Math.floor(durationSeconds)}
					value={pending}
					aria-label="Jump to a time"
					onChange={(e) => setPending(Number(e.target.value))}
					onMouseUp={() => onSeek(pending)}
					onTouchEnd={() => onSeek(pending)}
					onKeyUp={(e) => {
						if (e.key === "Enter") onSeek(pending);
					}}
					className="h-1 flex-1 cursor-pointer accent-[var(--ct-accent,currentColor)]"
				/>
				<span className="tabular shrink-0 text-xs text-fg-subtle">
					{fmt(pending)} / {fmt(durationSeconds)}
				</span>
			</div>
			<p className="text-[0.6875rem] text-fg-subtle">
				Converted as it plays, so jumping restarts the stream from that point.
				{startAt > 0 && ` Currently from ${fmt(startAt)}.`}
			</p>
		</div>
	);
}
