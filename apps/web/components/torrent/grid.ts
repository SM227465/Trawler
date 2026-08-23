/**
 * ONE grid template, shared by the header and every row. They were previously
 * two separate layouts (header: flex with w-20 cells; row: auto-width flex),
 * which silently drifted — headers sat ~300px left of their own data.
 * Importing the same constant makes that class of bug impossible.
 *
 * Columns: name+progress | size | seeds | peers | down | up | eta | actions
 */
export const ROW_GRID =
	"lg:grid lg:grid-cols-[minmax(12rem,1fr)_5.5rem_6.5rem_6.5rem_7rem_7rem_5rem_8rem] lg:items-center lg:gap-x-3";

export const COLUMNS = ["Name", "Size", "Seeds", "Peers", "Down", "Up", "ETA", ""] as const;
