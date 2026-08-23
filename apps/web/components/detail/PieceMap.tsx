"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { bucketise, countStates, PIECE } from "@/lib/pieceMap";
import type { PieceMap as PieceData } from "@/lib/useTorrentDetail";

/**
 * The piece map.
 *
 * A 20 GB torrent has ~10,000 pieces. Rendering 10,000 DOM nodes is not an
 * option, so this is one canvas downsampled to the element's pixel width.
 *
 * Each column takes the WORST state in its bucket, never an average (doc 04
 * §3.3). Averaging would make a single missing piece in a 40-piece bucket
 * invisible — and a single missing piece is precisely the thing you open this
 * view to find.
 */

const HEIGHT = 48;

/** Reads the theme's piece colours from CSS, so the canvas follows the tokens. */
function readColours(el: HTMLElement) {
	const s = getComputedStyle(el);
	return {
		[PIECE.MISSING]: s.getPropertyValue("--ct-piece-missing").trim() || "#ccc",
		[PIECE.DOWNLOADING]: s.getPropertyValue("--ct-piece-active").trim() || "#e5a000",
		[PIECE.HAVE]: s.getPropertyValue("--ct-piece-have").trim() || "#2a9d5c",
	} as Record<number, string>;
}

export function PieceMap({ data }: { data: PieceData }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [width, setWidth] = useState(0);
	// Bumped whenever the theme changes, to force a repaint with new colours.
	const [themeTick, setThemeTick] = useState(0);

	// Track the element's own width; the canvas is downsampled to exactly it.
	useEffect(() => {
		const el = canvasRef.current?.parentElement;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// The canvas paints raw colour values, so unlike everything else in the app
	// it cannot just inherit a token — it has to be told when the theme flips.
	useEffect(() => {
		const bump = () => setThemeTick((n) => n + 1);
		const mo = new MutationObserver(bump);
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		mq.addEventListener("change", bump);
		return () => {
			mo.disconnect();
			mq.removeEventListener("change", bump);
		};
	}, []);

	// `themeTick` is not read in the body and biome therefore calls it
	// unnecessary — but it IS the mechanism. The canvas paints resolved colour
	// values rather than CSS tokens, so a theme flip changes nothing until this
	// effect re-runs, and bumping the counter is what makes it re-run.
	// biome-ignore lint/correctness/useExhaustiveDependencies: themeTick exists to force the repaint
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || width === 0) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(HEIGHT * dpr);

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);

		const colours = readColours(canvas);
		const columns = bucketise(data.rle, data.total, width);

		// One fillRect per RUN of identical columns rather than per column: on a
		// complete torrent that is a single draw call instead of ~1200.
		let start = 0;
		for (let i = 1; i <= columns.length; i++) {
			if (i === columns.length || columns[i] !== columns[start]) {
				ctx.fillStyle = colours[columns[start]];
				ctx.fillRect(start, 0, i - start, HEIGHT);
				start = i;
			}
		}
	}, [data, width, themeTick]);

	const counts = countStates(data.rle);

	return (
		<div className="flex flex-col gap-3">
			<div className="overflow-hidden rounded-[var(--ct-radius)] border border-border bg-surface p-2">
				<canvas
					ref={canvasRef}
					style={{ width: "100%", height: HEIGHT }}
					role="img"
					aria-label={`Piece map: ${counts.have} of ${data.total} pieces downloaded`}
				/>
			</div>

			<ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
				{[
					["Have", counts.have, "bg-piece-have"],
					["Downloading", counts.downloading, "bg-piece-active"],
					["Missing", counts.missing, "bg-piece-missing"],
				].map(([label, n, tone]) => (
					<li key={label as string} className="flex items-center gap-1.5 text-fg-muted">
						<span className={cn("size-2.5 rounded-sm", tone as string)} aria-hidden />
						{label} <span className="tabular text-fg">{(n as number).toLocaleString()}</span>
					</li>
				))}
				<li className="ml-auto text-fg-subtle">
					<span className="tabular">{data.total.toLocaleString()}</span> pieces
				</li>
			</ul>
		</div>
	);
}
