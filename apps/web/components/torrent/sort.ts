import { wantedBytes } from "@/lib/torrentSize";
import type { TorrentIndexEntry } from "@/lib/useTorrentStream";

export type SortKey =
	| "name"
	| "sizeBytes"
	| "seedsConnected"
	| "peersConnected"
	| "availability"
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
	availability: "Availability",
	dlSpeedBps: "Down",
	upSpeedBps: "Up",
	etaSeconds: "ETA",
	addedAt: "Date added",
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareEntries(a: TorrentIndexEntry, b: TorrentIndexEntry, { key, dir }: SortState): number {
	const sign = dir === "asc" ? 1 : -1;

	if (key === "name") return sign * collator.compare(a.name, b.name);
	if (key === "addedAt") return sign * (Date.parse(a.addedAt) - Date.parse(b.addedAt));
	// By the size the column shows — what is being fetched, not the whole torrent.
	if (key === "sizeBytes") return sign * (wantedBytes(a) - wantedBytes(b));

	if (key === "etaSeconds" || key === "availability") {
		// null is "unknown" or "means nothing here" — ETA's ∞, availability on
		// anything not downloading. Always last, whichever direction: it is never
		// the most interesting row.
		const av = a[key];
		const bv = b[key];
		if (av === null && bv === null) return 0;
		if (av === null) return 1;
		if (bv === null) return -1;
		return sign * (av - bv);
	}

	return sign * ((a[key] as number) - (b[key] as number));
}
