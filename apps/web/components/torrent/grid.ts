import type { SortKey } from "./sort";

/**
 * ONE definition of the table's columns, shared by the header and every row.
 * They were once two separate layouts and silently drifted ~300px apart; a
 * single source makes that impossible.
 */
export const COLUMNS = ["Name", "Size", "Seeds", "Peers", "Down", "Up", "ETA", ""] as const;

/** Track width per column, in the same order. Name flexes; the rest are fixed. */
const WIDTH: Record<string, string> = {
	Name: "minmax(12rem,1fr)",
	Size: "5.5rem",
	Seeds: "6.5rem",
	Peers: "6.5rem",
	Down: "7rem",
	Up: "7rem",
	ETA: "5rem",
	"": "8rem", // actions
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
