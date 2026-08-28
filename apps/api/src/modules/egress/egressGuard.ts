import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { egressRepository } from "./egressRepository";

/**
 * The Oracle allowance guard.
 *
 * Free-tier egress is 10 TB a month. Exceeding it is not a slow-down, it is a
 * bill (or a suspended account), so this is a HARD stop rather than a warning.
 *
 * It applies to SHARE traffic only. Owner downloads are deliberately never
 * blocked: locking yourself out of your own files to protect a quota is a worse
 * outcome than the overage, and the owner can see the number and act on it.
 */

export type EgressVerdict =
	| { blocked: false; level: "ok" | "warn"; monthToDateBytes: number }
	| { blocked: true; level: "stop"; monthToDateBytes: number };

/**
 * Cached because /internal/authz runs on EVERY byte request — aria2c opens 16
 * connections, and a database round trip per connection would make the guard
 * itself the bottleneck. A minute of staleness against a 10 TB budget is noise.
 */
const TTL_MS = 60_000;
let cached: { at: number; bytes: number } | null = null;

async function monthToDate(): Promise<number> {
	if (cached && Date.now() - cached.at < TTL_MS) return cached.bytes;
	const bytes = await egressRepository.monthToDateBytes();
	cached = { at: Date.now(), bytes };
	return bytes;
}

/** Forces the next check to re-read. Used after ingesting a batch. */
export function invalidateEgressCache() {
	cached = null;
}

export async function checkEgress(): Promise<EgressVerdict> {
	let bytes: number;
	try {
		bytes = await monthToDate();
	} catch (err) {
		// Fail OPEN. A database hiccup must not take every share link down; the
		// nightly job and the dashboard will still surface a real overage.
		logger.error({ err }, "egress check failed - allowing the request");
		return { blocked: false, level: "ok", monthToDateBytes: 0 };
	}

	if (bytes >= env.EGRESS_HARD_STOP_BYTES) {
		return { blocked: true, level: "stop", monthToDateBytes: bytes };
	}
	if (bytes >= env.EGRESS_SOFT_ALERT_BYTES) {
		return { blocked: false, level: "warn", monthToDateBytes: bytes };
	}
	return { blocked: false, level: "ok", monthToDateBytes: bytes };
}

export async function egressStatus() {
	const [bytes, torrentBytes] = await Promise.all([
		egressRepository.monthToDateBytes(),
		egressRepository.monthToDateTorrentBytes(),
	]);
	return {
		monthToDateBytes: bytes,
		// Seeding, counted from qBittorrent rather than Caddy's log. Reported
		// separately because only the HTTP half can be throttled by the share
		// guard — the torrent port does not pass through us at all.
		torrentBytes,
		totalBytes: bytes + torrentBytes,
		softAlertBytes: env.EGRESS_SOFT_ALERT_BYTES,
		hardStopBytes: env.EGRESS_HARD_STOP_BYTES,
		level:
			bytes >= env.EGRESS_HARD_STOP_BYTES ? "stop" : bytes >= env.EGRESS_SOFT_ALERT_BYTES ? "warn" : ("ok" as const),
		usedPct: env.EGRESS_HARD_STOP_BYTES > 0 ? (bytes / env.EGRESS_HARD_STOP_BYTES) * 100 : 0,
		daily: await egressRepository.recentDays(30),
	};
}
