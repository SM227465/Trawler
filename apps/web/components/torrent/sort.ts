import type { TorrentIndexEntry } from "@/lib/useTorrentStream";

export type SortKey =
	| "name"
	| "sizeBytes"
	| "seedsConnected"
	| "peersConnected"
	| "dlSpeedBps"
	| "upSpeedBps"
	| "etaSeconds"
	| "addedAt";

export type SortDir = "asc" | "desc";

export interface SortState {
	key: SortKey;
	dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: "addedAt", dir: "desc" };

export const SORT_LABELS: Record<SortKey, string> = {
	name: "Name",
	sizeBytes: "Size",
	seedsConnected: "Seeds",
	peersConnected: "Peers",
	dlSpeedBps: "Down",
	upSpeedBps: "Up",
	etaSeconds: "ETA",
	addedAt: "Date added",
};

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

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareEntries(a: TorrentIndexEntry, b: TorrentIndexEntry, { key, dir }: SortState): number {
	const sign = dir === "asc" ? 1 : -1;

	if (key === "name") return sign * collator.compare(a.name, b.name);
	if (key === "addedAt") return sign * (Date.parse(a.addedAt) - Date.parse(b.addedAt));

	if (key === "etaSeconds") {
		// null is qBittorrent's "unknown" (∞). Always sort it last, whichever
		// direction — an unknown ETA is never the most interesting row.
		const av = a.etaSeconds;
		const bv = b.etaSeconds;
		if (av === null && bv === null) return 0;
		if (av === null) return 1;
		if (bv === null) return -1;
		return sign * (av - bv);
	}

	return sign * ((a[key] as number) - (b[key] as number));
}
