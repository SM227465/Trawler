"use client";
import { MonitorPlay, Play } from "lucide-react";
import { useState } from "react";

/**
 * Plays a shared file on the share page itself.
 *
 * Deliberately click-to-start rather than autoplay. The page is opened by
 * someone who was handed a link; starting a video by itself is rude, and on a
 * remuxed file it would also spend a conversion slot before anyone asked for
 * one.
 *
 * The /dl and /remux routes both authenticate by share id alone, so a plain
 * <video> element works here with no session at all.
 */
export function SharePlayer({
	shareId,
	name,
	playback,
	durationSeconds,
}: {
	shareId: string;
	name: string;
	playback: "direct" | "remux" | "incompatible" | "not_media" | null;
	durationSeconds: number | null;
}) {
	const [started, setStarted] = useState(false);
	const [failed, setFailed] = useState(false);
	const [startAt, setStartAt] = useState(0);

	if (playback !== "direct" && playback !== "remux") return null;

	const encoded = encodeURIComponent(name);
	const src =
		playback === "remux"
			? `/remux/${shareId}/${encodeURIComponent(name.replace(/\.[^.]+$/, ""))}.mp4${startAt > 0 ? `?t=${startAt}` : ""}`
			: `/dl/${shareId}/${encoded}`;

	if (!started) {
		return (
			<button
				type="button"
				onClick={() => setStarted(true)}
				className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset py-3 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
			>
				<Play className="size-4" aria-hidden />
				Play here
			</button>
		);
	}

	if (failed) {
		return (
			<div className="mt-5 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset p-4 text-center">
				<MonitorPlay className="mx-auto size-6 text-fg-subtle" aria-hidden />
				<p className="mt-2 text-sm text-fg">This one will not play in the browser.</p>
				<p className="mt-1 text-xs text-fg-muted">Download it instead, or open the link in VLC.</p>
			</div>
		);
	}

	return (
		<div className="mt-5">
			{/* biome-ignore lint/a11y/useMediaCaption: no caption track exists for a shared file */}
			<video
				key={startAt}
				src={src}
				controls
				autoPlay
				playsInline
				onError={() => setFailed(true)}
				className="w-full rounded-[var(--ct-radius-sm)] bg-black"
			/>
			{playback === "remux" && durationSeconds ? (
				<div className="mt-2 flex items-center gap-2">
					<input
						type="range"
						min={0}
						max={Math.floor(durationSeconds)}
						defaultValue={0}
						aria-label="Jump to a time"
						onMouseUp={(e) => setStartAt(Number((e.target as HTMLInputElement).value))}
						onTouchEnd={(e) => setStartAt(Number((e.target as HTMLInputElement).value))}
						className="h-1 flex-1 cursor-pointer"
					/>
					<span className="shrink-0 text-[0.6875rem] text-fg-subtle">converted as it plays</span>
				</div>
			) : null}
		</div>
	);
}
