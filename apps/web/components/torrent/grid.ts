import type { SortKey } from "./sort";

/**
 * ONE definition of the table's columns, shared by the header and every row.
 * They were once two separate layouts and silently drifted ~300px apart; a
 * single source makes that impossible.
 */
export const COLUMNS = ["Name", "Status", "Size", "Seeds", "Peers", "Availability", "Down", "Up", "ETA", ""] as const;
export type Column = (typeof COLUMNS)[number];

/** What the header prints where the column's own name is wider than its track. */
export const HEADER_LABEL: Partial<Record<Column, string>> = { Availability: "Avail." };

/**
 * Track width per column. Name flexes; the rest are fixed.
 *
 * The actions track must fit its buttons or the whole row overflows. The most
 * any row shows is five — files, recheck, pause, copy, delete — at 2rem each
 * with 0.125rem between them: 10.5rem. Recheck only appears on an errored row,
 * so the usual four leave a little slack rather than the row jumping about.
 * It was 8rem, so every row overflowed by 48px on a 1366px laptop. That showed
 * up twice — a horizontal scrollbar, and a progress fill that stopped short of
 * the right edge, because `width: 100%` resolves against the visible box and
 * not the scrolled width.
 *
 * The stat columns paid for it. They were sized for values like "1.23 GB/s"
 * that only appear mid-transfer, and were carrying dead space the rest of the
 * time.
 */
const WIDTH: Record<Column, string> = {
	Name: "minmax(10rem,1fr)",
	// The chip and one short note beside it — "Downloading 99.9%" is the widest
	// at ~140px. It used to live inside the name cell, where it took the same
	// width from the name on every row, just less visibly. Every column on at
	// 1366px leaves the name at its 10rem floor: 9.5rem here and 4rem for
	// Availability overflowed the card by 18px and clipped the delete button.
	Status: "8.75rem",
	// "6.07 GB" and "0 (103)" both fit 4.5rem at this size; the half rem each
	// was carrying went to the name, which is the only column anyone reads.
	Size: "4.5rem",
	Seeds: "4.5rem",
	Peers: "4.5rem",
	// "⚠ 99%" is the widest, ~43px — "100%" never carries the warning. The
	// header says "Avail." to fit.
	Availability: "3.25rem",
	// Speeds keep theirs: "1.23 MB/s" with its arrow is genuinely that wide.
	Down: "5.5rem",
	Up: "5.5rem",
	ETA: "4.5rem",
	"": "10.5rem", // actions — 5 x size-8 + 4 x gap-0.5
};

/** The columns actually on screen, in order. Name and actions cannot be hidden. */
export const visibleColumns = (hidden: Set<string>): Column[] =>
	COLUMNS.filter((c) => c === "Name" || c === "" || !hidden.has(c));

/**
 * The grid template for a given set of hidden columns.
 *
 * Delivered as a CSS custom property rather than a Tailwind class: the set is
 * dynamic, and Tailwind's JIT only emits classes it can see literally in the
 * source. An inline `grid-template-columns` would also leak past the `lg`
 * breakpoint and break the stacked mobile layout, whereas a variable consumed
 * inside the media query does not.
 */
export function gridTemplate(hidden: Set<string>): string {
	return visibleColumns(hidden)
		.map((c) => WIDTH[c])
		.join(" ");
}

/** Base class; the template itself comes from --ct-cols. See globals.css. */
export const ROW_GRID = "ct-row-grid";

/**
 * Which sort key each column maps to. `null` = not sortable — Status has the
 * filter tabs, which group by it better than an ordering would.
 *
 * Keyed by column rather than by position. The positional version could not
 * survive a hidden column: the header indexed it against the visible set.
 */
export const COLUMN_SORT: Record<Column, SortKey | null> = {
	Name: "name",
	Status: null,
	Size: "sizeBytes",
	Seeds: "seedsConnected",
	Peers: "peersConnected",
	Availability: "availability",
	Down: "dlSpeedBps",
	Up: "upSpeedBps",
	ETA: "etaSeconds",
	"": null,
};
