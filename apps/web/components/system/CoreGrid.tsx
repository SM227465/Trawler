"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Per-core usage. The count is NOT assumed — an Ampere box can report 4, and a
 * bigger host 64. `auto-fill` reflows to any number, tiles shrink past a
 * threshold, and beyond `INITIAL` the rest are collapsed behind a toggle so a
 * 64-core host does not push everything else off the page.
 */
const INITIAL = 16;

export function CoreGrid({ cores }: { cores: number[] }) {
	const [expanded, setExpanded] = useState(false);
	const dense = cores.length > 16;
	const shown = expanded ? cores : cores.slice(0, INITIAL);
	const hidden = cores.length - shown.length;

	return (
		<div>
			<ul
				className={cn(
					"grid gap-2",
					dense
						? "grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))]"
						: "grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]",
				)}
			>
				{shown.map((c, i) => (
					<li
						key={`core-${i}`}
						className={cn("rounded-[var(--ct-radius-sm)] bg-surface-inset", dense ? "p-1.5" : "p-2")}
						title={`CPU ${i + 1} — ${c.toFixed(0)}%`}
					>
						<p className="truncate text-[0.625rem] uppercase tracking-wide text-fg-subtle">
							{dense ? i + 1 : `CPU ${i + 1}`}
						</p>
						<p className={cn("tabular font-medium text-fg", dense ? "text-xs" : "text-sm")}>{c.toFixed(0)}%</p>
						<div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
							<div className="h-full rounded-full bg-viz-1" style={{ width: `${Math.min(100, c)}%` }} />
						</div>
					</li>
				))}
			</ul>

			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="mt-2 cursor-pointer text-xs text-accent hover:underline"
				>
					Show {hidden} more core{hidden === 1 ? "" : "s"}
				</button>
			)}
			{expanded && cores.length > INITIAL && (
				<button
					type="button"
					onClick={() => setExpanded(false)}
					className="mt-2 cursor-pointer text-xs text-fg-muted hover:underline"
				>
					Show fewer
				</button>
			)}
		</div>
	);
}
