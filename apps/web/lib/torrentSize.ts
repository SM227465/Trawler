/**
 * Which size a torrent should show.
 *
 * `sizeBytes` counts every file in the torrent. `selectedBytes` counts only the
 * files not set to skip — and that is what qBittorrent measures progress and
 * ETA against. Showing the first beside a progress bar driven by the second
 * gives "60 GB · 100%" for a season pack where one 4 GB episode is done.
 *
 * Same convention as qBittorrent's own UI: "Size" is what you are fetching,
 * "Total size" is what the torrent contains.
 */

interface Sized {
	sizeBytes: number;
	selectedBytes?: number | null;
}

/** What is being fetched. Falls back to the total until the poller has reported. */
export const wantedBytes = (t: Sized): number => t.selectedBytes ?? t.sizeBytes;

/** Some files are set to skip, so the two sizes genuinely differ. */
export const isPartialSelection = (t: Sized): boolean =>
	t.selectedBytes != null && t.sizeBytes > 0 && t.selectedBytes < t.sizeBytes;
