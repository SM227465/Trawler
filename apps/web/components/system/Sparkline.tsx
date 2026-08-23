"use client";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export interface Series {
	label: string;
	values: number[];
	/** A token utility name, never a raw colour — e.g. "viz-1". */
	tone: "viz-1" | "viz-2" | "viz-3" | "viz-4";
}

const STROKE: Record<Series["tone"], string> = {
	"viz-1": "stroke-viz-1",
	"viz-2": "stroke-viz-2",
	"viz-3": "stroke-viz-3",
	"viz-4": "stroke-viz-4",
};
const FILL: Record<Series["tone"], string> = {
	"viz-1": "fill-viz-1",
	"viz-2": "fill-viz-2",
	"viz-3": "fill-viz-3",
	"viz-4": "fill-viz-4",
};
const TEXT: Record<Series["tone"], string> = {
	"viz-1": "text-viz-1",
	"viz-2": "text-viz-2",
	"viz-3": "text-viz-3",
	"viz-4": "text-viz-4",
};

const W = 300;
const H = 64;

/**
 * Area sparkline over a fixed window. Hand-rolled SVG rather than a chart
 * library: the whole thing is ~40 lines of path maths, and the bundle already
 * sits at the doc 03 §B8 budget.
 *
 * One shared y-scale across every series in a chart — never a second axis
 * (dataviz non-negotiable). Two measures of different scale get two charts.
 */
export function Sparkline({
	series,
	max,
	format,
	className,
}: {
	series: Series[];
	/** Fixed ceiling (e.g. 100 for %). Omit to scale to the data. */
	max?: number;
	format: (v: number) => string;
	className?: string;
}) {
	const gradId = useId();
	const [hover, setHover] = useState<number | null>(null);

	const len = Math.max(...series.map((s) => s.values.length), 1);
	const ceiling = useMemo(() => {
		if (max !== undefined) return max;
		const peak = Math.max(...series.flatMap((s) => s.values), 0);
		return peak > 0 ? peak * 1.15 : 1;
	}, [series, max]);

	const x = (i: number) => (len <= 1 ? 0 : (i / (len - 1)) * W);
	const y = (v: number) => H - Math.min(1, Math.max(0, v / ceiling)) * (H - 2) - 1;

	const paths = series.map((s) => {
		// Left-pad so a short history grows in from the right, like a real monitor.
		const pad = len - s.values.length;
		const pts = s.values.map((v, i) => `${x(i + pad).toFixed(2)},${y(v).toFixed(2)}`);
		return {
			...s,
			line: pts.length > 1 ? `M${pts.join("L")}` : "",
			area: pts.length > 1 ? `M${x(pad)},${H} L${pts.join("L")} L${W},${H} Z` : "",
		};
	});

	return (
		<div className={cn("relative", className)}>
			<svg
				viewBox={`0 0 ${W} ${H}`}
				preserveAspectRatio="none"
				className="h-16 w-full"
				role="img"
				aria-label={series.map((s) => `${s.label}: ${format(s.values.at(-1) ?? 0)}`).join(", ")}
				onMouseLeave={() => setHover(null)}
				onMouseMove={(e) => {
					const r = e.currentTarget.getBoundingClientRect();
					const ratio = (e.clientX - r.left) / r.width;
					setHover(Math.min(len - 1, Math.max(0, Math.round(ratio * (len - 1)))));
				}}
			>
				<defs>
					{paths.map((p) => (
						<linearGradient key={p.label} id={`${gradId}-${p.tone}`} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopOpacity="0.28" className={FILL[p.tone]} />
							<stop offset="100%" stopOpacity="0.02" className={FILL[p.tone]} />
						</linearGradient>
					))}
				</defs>

				{paths.map((p) => (
					<g key={p.label}>
						{p.area && <path d={p.area} fill={`url(#${gradId}-${p.tone})`} />}
						{p.line && (
							<path
								d={p.line}
								fill="none"
								strokeWidth={2}
								strokeLinejoin="round"
								strokeLinecap="round"
								vectorEffect="non-scaling-stroke"
								className={STROKE[p.tone]}
							/>
						)}
					</g>
				))}

				{hover !== null && (
					<line
						x1={x(hover)}
						x2={x(hover)}
						y1={0}
						y2={H}
						strokeWidth={1}
						vectorEffect="non-scaling-stroke"
						className="stroke-border-strong"
					/>
				)}
			</svg>

			{hover !== null && (
				<div
					className={cn(
						"pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-[var(--ct-radius-sm)]",
						"border border-border bg-surface px-2 py-1 shadow-[var(--ct-shadow)]",
					)}
					style={{ left: `${(hover / Math.max(1, len - 1)) * 100}%`, transform: "translate(-50%, -100%)" }}
				>
					{series.map((s) => {
						const pad = len - s.values.length;
						const v = s.values[hover - pad];
						return (
							<p key={s.label} className="tabular whitespace-nowrap text-[0.6875rem] text-fg">
								<span className={TEXT[s.tone]}>●</span> {s.label} {v === undefined ? "—" : format(v)}
							</p>
						);
					})}
				</div>
			)}
		</div>
	);
}
