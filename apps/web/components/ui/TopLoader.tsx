"use client";
import { useIsFetching } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState } from "react";

/** Loads that finish faster than this never show the bar at all. */
const SHOW_DELAY = 120;
/** A route commits a beat before its page's queries start; bridge that gap so
 *  the bar keeps crawling instead of completing and restarting. */
const SETTLE = 100;
const FINISH_MS = 200;
const FADE_MS = 250;

type Phase = "idle" | "loading" | "done";

/**
 * Next's App Router has no router events, so a navigation starts when a
 * same-origin link to another path is clicked and ends when that path commits.
 */
function useLinkNavigation(): boolean {
	const pathname = usePathname();
	const [from, setFrom] = useState<string | null>(null);

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			const a = (e.target as Element | null)?.closest("a[href]");
			if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return;
			if (a.target && a.target !== "_self") return;
			const url = new URL(a.href);
			// Query/hash-only changes stay on the same page; any data they pull in
			// shows up as a first load below.
			if (url.origin !== location.origin || url.pathname === location.pathname) return;
			setFrom(location.pathname);
		};
		// Capture, so a handler that stops propagation cannot hide the click.
		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, []);

	// Cleared rather than just compared, or going Back to `from` later would
	// read as a navigation in flight.
	if (from !== null && from !== pathname) setFrom(null);
	return from !== null;
}

/**
 * The YouTube-style bar along the top edge. Runs while a link navigation is
 * pending or any query is fetching for the FIRST time — background refetches
 * (SSE-driven updates, polls) already have data and never trigger it.
 */
export function TopLoader() {
	const navigating = useLinkNavigation();
	const firstLoads = useIsFetching({ predicate: (q) => q.state.data === undefined });
	const active = navigating || firstLoads > 0;

	const [phase, setPhase] = useState<Phase>("idle");
	const [progress, setProgress] = useState(0);
	// The effect below needs the current phase without re-running on it.
	const phaseRef = useRef<Phase>("idle");
	const go = (p: Phase) => {
		phaseRef.current = p;
		setPhase(p);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: `go` only touches a ref and a state setter
	useEffect(() => {
		if (active) {
			let start: ReturnType<typeof setTimeout> | undefined;
			if (phaseRef.current !== "loading") {
				go("idle");
				start = setTimeout(() => {
					setProgress(0.2);
					go("loading");
				}, SHOW_DELAY);
			}
			// Creep toward 90% and never reach it — the real end is unknown.
			const trickle = setInterval(() => setProgress((p) => p + (0.9 - p) * 0.08), 300);
			return () => {
				clearTimeout(start);
				clearInterval(trickle);
			};
		}

		if (phaseRef.current !== "loading") return;
		let hide: ReturnType<typeof setTimeout> | undefined;
		const finish = setTimeout(() => {
			go("done");
			hide = setTimeout(() => go("idle"), FINISH_MS + FADE_MS);
		}, SETTLE);
		return () => {
			clearTimeout(finish);
			clearTimeout(hide);
		};
	}, [active]);

	const style: CSSProperties =
		phase === "idle"
			? { transform: "scaleX(0)", opacity: 0, transition: "none" }
			: phase === "loading"
				? { transform: `scaleX(${progress})`, opacity: 1, transition: "transform 300ms ease-out" }
				: {
						transform: "scaleX(1)",
						opacity: 0,
						transition: `transform ${FINISH_MS}ms ease-out, opacity ${FADE_MS}ms ease ${FINISH_MS}ms`,
					};

	return (
		<div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
			<div className="h-full origin-left bg-accent shadow-[0_0_8px_var(--ct-accent)]" style={style} />
		</div>
	);
}
