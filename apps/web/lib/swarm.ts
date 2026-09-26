/**
 * Availability: how many complete copies of the torrent the connected peers
 * hold between them — qBittorrent's "distributed copies". Below 1.0, no peer
 * set adds up to every piece, which is THE reason a torrent sticks at 97% and
 * the thing everyone assumes is a client bug.
 */

const FETCHING_METADATA = new Set(["metaDL", "forcedMetaDL"]);

/**
 * The number, or null wherever it means nothing:
 *  - not downloading: libtorrent stops tracking piece availability once a
 *    torrent is complete and reports -1, and a paused one has no peers;
 *  - still fetching metadata: there are no pieces yet to be available.
 */
export function availabilityOf(t: { status: string; qbtState?: string | null; availability: number }): number | null {
	if (t.status !== "downloading") return null;
	if (t.qbtState && FETCHING_METADATA.has(t.qbtState)) return null;
	return t.availability >= 0 ? t.availability : null;
}

/**
 * Above zero and below one: peers are connected but no full copy exists among
 * them. Zero is NOT flagged — that is a torrent with no peers yet, which every
 * fresh download is for its first few seconds.
 */
export const isIncompleteSwarm = (availability: number | null): boolean =>
	availability !== null && availability > 0 && availability < 1;
