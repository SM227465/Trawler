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

/**
 * Availability as a share of the file. libtorrent's figure is full copies plus
 * a fraction — 0.71 is no full copy, with 71% of the pieces held somewhere
 * among the connected peers and what is already on disk — so anything at or
 * above 1 is the whole file: 100%. How many extra copies exist past that is
 * left to the tooltip.
 *
 * Floored, never rounded: 0.996 printed as "1.00" beside a warning that the
 * torrent could not finish, and "100%" would say the same wrong thing. The
 * epsilon is for float noise — 0.71 * 100 is 70.99999999999999.
 */
export function formatAvailability(availability: number): string {
	if (availability >= 1) return "100%";
	if (availability > 0 && availability < 0.01) return "<1%";
	return `${Math.floor(availability * 100 + 1e-9)}%`;
}
