import type { SortKey } from "./sort";

/**
 * ONE definition of the table's columns, shared by the header and every row.
 * They were once two separate layouts and silently drifted ~300px apart; a
 * single source makes that impossible.
 */
export const COLUMNS = ["Name", "Size", "Seeds", "Peers", "Down", "Up", "ETA", ""] as const;

/**
 * Track width per column, in the same order. Name flexes; the rest are fixed.
 *
 * The actions track must fit its buttons or the whole row overflows: five
 * `size="icon"` buttons are 5 x 2rem plus four 0.25rem gaps = 11rem exactly.
 * It was 8rem, so every row overflowed by 48px on a 1366px laptop. That showed
 * up twice — a horizontal scrollbar, and a progress fill that stopped short of
 * the right edge, because `width: 100%` resolves against the visible box and
 * not the scrolled width.
 *
 * The stat columns paid for it. They were sized for values like "1.23 GB/s"
 * that only appear mid-transfer, and were carrying dead space the rest of the
 * time. Total minimum is now ~908px against ~1010px available at 1366px, so
 * there is room for the name to grow rather than none to spare.
 */
const WIDTH: Record<string, string> = {
	Name: "minmax(10rem,1fr)",
	Size: "5rem",
	Seeds: "5rem",
	Peers: "5rem",
	Down: "5.5rem",
	Up: "5.5rem",
	ETA: "4.5rem",
	"": "11rem", // actions — 5 x size-8 + 4 x gap-1
};

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
	return COLUMNS.filter((c) => c === "Name" || c === "" || !hidden.has(c))
		.map((c) => WIDTH[c])
		.join(" ");
}

/** Base class; the template itself comes from --ct-cols. See globals.css. */
export const ROW_GRID = "ct-row-grid";

/** Which sort key each visible column maps to. `null` = not sortable. */
export const COLUMN_SORT: Array<SortKey | null> = [
	"name",
	"sizeBytes",
	"seedsConnected",
	"peersConnected",
	"dlSpeedBps",
	"upSpeedBps",
	"etaSeconds",
	null,
];
