"use client";
import { useEffect, useState } from "react";
import { canDecode, type PlaybackCheck } from "./media";

/** `unknown` means nothing to ask, or no straight answer: play and see. */
export type Decodable = "checking" | "yes" | "no" | "unknown";

/**
 * Asks the device about a stream before anything is fetched.
 *
 * "checking" until the answer for THIS check is in — never a provisional
 * "unknown", which would mount the <video> for a frame and start a stream (on
 * a remux, a conversion slot) the device may be about to refuse.
 */
export function useCanDecode(check: PlaybackCheck | null | undefined, enabled: boolean): Decodable {
	const [answer, setAnswer] = useState<{ key: string; value: Decodable } | null>(null);

	// Keyed on the VALUE. The file list refetches on a timer and hands back an
	// equal but new object; re-asking would flip to "checking" and unmount a
	// video that is already playing.
	const key = check ? JSON.stringify(check) : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for `check`
	useEffect(() => {
		if (!enabled || !check || !key) return;
		let live = true;
		canDecode(check).then((ok) => {
			if (live) setAnswer({ key, value: ok === null ? "unknown" : ok ? "yes" : "no" });
		});
		return () => {
			live = false;
		};
	}, [enabled, key]);

	if (!enabled || !key) return "unknown";
	return answer?.key === key ? answer.value : "checking";
}
