"use client";
import { Play } from "lucide-react";
import { useState } from "react";
import { ExternalPlayers } from "@/components/files/ExternalPlayers";
import type { PlaybackCheck } from "@/lib/media";
import { useCanDecode } from "@/lib/useCanDecode";

/**
 * Plays a shared file on the share page itself.
 *
 * Deliberately click-to-start rather than autoplay. The page is opened by
 * someone who was handed a link; starting a video by itself is rude, and on a
 * remuxed file it would also spend a conversion slot before anyone asked for
 * one.
 *
 * The /dl and /remux routes both authenticate by share id alone, so a plain
 * <video> element works here with no session at all — and so does VLC on the
 * visitor's phone, which is where a file their browser cannot decode goes.
 *
 * The device is asked on load rather than on Play: asking fetches nothing,
 * and a visitor whose browser cannot decode the file should see their way to
 * watch it, not a Play button that leads to an error.
 */
export function SharePlayer({
	shareId,
	name,
	playback,
	durationSeconds,
	check,
}: {
	shareId: string;
	name: string;
	playback: "direct" | "remux" | "incompatible" | "not_media" | null;
	durationSeconds: number | null;
	check: PlaybackCheck | null;
}) {
	const [started, setStarted] = useState(false);
	const [failed, setFailed] = useState(false);
	const [startAt, setStartAt] = useState(0);
	const decodable = useCanDecode(check, true);
	const [tryAnyway, setTryAnyway] = useState(false);
	const refused = decodable === "no" && !tryAnyway;

	if (playback !== "direct" && playback !== "remux") return null;

	const encoded = encodeURIComponent(name);
	const src =
		playback === "remux"
			? `/remux/${shareId}/${encodeURIComponent(name.replace(/\.[^.]+$/, ""))}.mp4${startAt > 0 ? `?t=${startAt}` : ""}`
			: `/dl/${shareId}/${encoded}`;

	if (failed || refused) {
		return (
			<div className="mt-5">
				<ExternalPlayers
					url={`${window.location.origin}/dl/${shareId}/${encoded}`}
					name={name}
					reason={
						refused
							? `This device cannot decode ${check?.label ?? "this"} video in the browser`
							: "This one will not play in the browser"
					}
					onTryAnyway={
						refused
							? () => {
									setTryAnyway(true);
									setStarted(true);
								}
							: undefined
					}
				/>
			</div>
		);
	}

	if (!started) {
		return (
			<button
				type="button"
				onClick={() => setStarted(true)}
				disabled={decodable === "checking"}
				className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--ct-radius-sm)] border border-border bg-surface-inset py-3 text-sm text-fg transition-colors hover:border-accent hover:text-accent"
			>
				<Play className="size-4" aria-hidden />
				Play here
			</button>
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
