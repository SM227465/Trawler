import type { BrowseEntry } from "./api";
import { classify } from "./media";

export type FileSortKey = "name" | "size" | "type" | "modified";
export type SortDir = "asc" | "desc";

export const FILE_SORT_LABELS: Record<FileSortKey, string> = {
	name: "Name",
	size: "Size",
	type: "Type",
	modified: "Modified",
};

/**
 * The direction a column sorts in when first chosen — what people look for:
 * A to Z, but the biggest and newest first.
 */
export const DEFAULT_DIR: Record<FileSortKey, SortDir> = { name: "asc", type: "asc", size: "desc", modified: "desc" };

const SUBTITLES = /\.(srt|vtt|ass|ssa|sub|idx)$/i;
const KIND_WORD = { video: "video", audio: "audio", image: "image", pdf: "document", text: "text", other: "file" };

/** "MKV video", "SRT subtitles", "Folder" — the Type column of a file manager. */
export function typeLabel(entry: BrowseEntry): string {
	if (entry.type === "dir") return "Folder";
	const ext = entry.name.match(/\.([^./]+)$/)?.[1]?.toUpperCase();
	if (!ext) return "File";
	// Subtitles classify as text, which is true and unhelpful next to the video they belong to.
	if (SUBTITLES.test(entry.name)) return `${ext} subtitles`;
	return `${ext} ${KIND_WORD[classify(entry.name).kind]}`;
}

/** Natural order, so "Episode 2" comes before "Episode 10". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Folders first whatever the order, as in Explorer and Nautilus. Ties fall
 * back to the name, so the order never shuffles between refetches.
 */
export function sortEntries(entries: BrowseEntry[], key: FileSortKey, dir: SortDir): BrowseEntry[] {
	const sign = dir === "asc" ? 1 : -1;
	const byKey = (a: BrowseEntry, b: BrowseEntry) => {
		switch (key) {
			case "size":
				return a.sizeBytes - b.sizeBytes;
			case "modified":
				return Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt);
			case "type":
				return collator.compare(typeLabel(a), typeLabel(b));
			default:
				return collator.compare(a.name, b.name);
		}
	};
	return [...entries].sort((a, b) => {
		if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
		// Ties read A to Z whichever way the column runs. Folders all weigh 0, and
		// "largest first" listing them Z to A would look like a bug.
		return sign * byKey(a, b) || collator.compare(a.name, b.name);
	});
}

export const isSortKey = (v: string): v is FileSortKey => v in FILE_SORT_LABELS;
