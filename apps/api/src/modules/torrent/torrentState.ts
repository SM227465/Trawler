/** qBittorrent state → our coarse lifecycle. Doc 04 §2.3. */
export type TorrentStatus = "queued" | "downloading" | "paused" | "completed" | "errored" | "evicted";

// qBittorrent 5.0 renamed paused* → stopped*. Both spellings are handled so an
// image bump does not silently turn every row into "unknown". We currently run
// v5.2.3, i.e. the stopped* side.
const PAUSED = new Set(["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]);
const ERRORED = new Set(["error", "missingFiles"]);
const COMPLETED = new Set(["uploading", "stalledUP", "queuedUP", "forcedUP"]);
const DOWNLOADING = new Set([
	"downloading",
	"metaDL",
	"forcedMetaDL",
	"stalledDL",
	"queuedDL",
	"forcedDL",
	"allocating",
	"checkingDL",
	"checkingUP",
	"checkingResumeData",
	"moving",
]);

export const mapState = (state: string | undefined): TorrentStatus => {
	if (!state) return "queued";
	if (PAUSED.has(state)) return "paused";
	if (ERRORED.has(state)) return "errored";
	if (COMPLETED.has(state)) return "completed";
	if (DOWNLOADING.has(state)) return "downloading";
	return "queued";
};

/** qBittorrent's sentinel for "unknown ETA". Render ∞, never "100 days". */
export const ETA_UNKNOWN = 8_640_000;
export const normalizeEta = (eta: number | undefined): number | null =>
	eta === undefined || eta >= ETA_UNKNOWN ? null : eta;

/** Long-running states where a speed/ETA reading is meaningless. */
export const isCheckingState = (state: string | undefined) =>
	state === "checkingDL" || state === "checkingUP" || state === "checkingResumeData" || state === "moving";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32ToHex = (input: string): string => {
	let bits = "";
	for (const ch of input.toUpperCase()) {
		const idx = B32_ALPHABET.indexOf(ch);
		if (idx < 0) throw new Error("invalid base32 in magnet");
		bits += idx.toString(2).padStart(5, "0");
	}
	let hex = "";
	for (let i = 0; i + 4 <= bits.length; i += 4) {
		hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
	}
	return hex;
};

/**
 * Extracts the v1 infohash as lowercase hex. Handles both encodings — 40-char
 * hex and 32-char base32 (older trackers still emit base32).
 */
export const parseInfoHash = (magnet: string): string | null => {
	const m = /xt=urn:btih:([a-zA-Z0-9]{32,40})/.exec(magnet);
	if (!m) return null;
	const raw = m[1];
	if (/^[a-fA-F0-9]{40}$/.test(raw)) return raw.toLowerCase();
	if (/^[a-zA-Z2-7]{32}$/.test(raw)) {
		try {
			return base32ToHex(raw).toLowerCase();
		} catch {
			return null;
		}
	}
	return null;
};

export const parseDisplayName = (magnet: string): string | null => {
	const m = /[?&]dn=([^&]+)/.exec(magnet);
	if (!m) return null;
	try {
		return decodeURIComponent(m[1].replace(/\+/g, " "));
	} catch {
		return null;
	}
};
