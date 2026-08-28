/**
 * Formatters are module-scope singletons on purpose. Constructing an
 * Intl.NumberFormat per cell per tick is a real, measurable cost in a table
 * that updates at 1 Hz — doc 04 §6.
 */
const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
	let i = 0;
	let v = bytes;
	while (v >= 1024 && i < UNITS.length - 1) {
		v /= 1024;
		i++;
	}
	const fmt = i === 0 ? nf0 : v >= 100 ? nf0 : v >= 10 ? nf1 : nf2;
	return `${fmt.format(v)} ${UNITS[i]}`;
}

export const formatSpeed = (bps: number | null | undefined): string =>
	!bps || bps <= 0 ? "—" : `${formatBytes(bps)}/s`;

/** qBittorrent's 8640000 sentinel arrives as null. Render ∞, never "100 days". */
export function formatEta(seconds: number | null | undefined): string {
	if (seconds == null) return "∞";
	if (seconds <= 0) return "—";
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

export function formatDuration(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return "—";
	return formatEta(seconds);
}

export const formatPercent = (fraction: number): string => `${nf1.format(Math.min(fraction, 1) * 100)}%`;
export const formatRatio = (r: number): string => nf2.format(r ?? 0);

/** Seeds/peers are shown as "connected (swarm)" — they are different numbers. */
/**
 * `2 (5)` — connected, and the swarm total in brackets.
 *
 * Guards non-finite input rather than trusting it. A partially populated
 * torrent once reached this and rendered "NaN (NaN)", which looks like a bug in
 * the swarm rather than in whatever handed us an incomplete object. The real
 * cause is fixed upstream; this makes the symptom impossible to reproduce.
 */
export const formatSwarm = (connected: number | undefined, total: number | undefined): string => {
	const n = (v: number | undefined) => (Number.isFinite(v) ? nf0.format(v as number) : "—");
	return `${n(connected)} (${n(total)})`;
};

export function formatRelative(iso: string | null | undefined): string {
	if (!iso) return "—";
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "—";
	const diff = Math.round((then - Date.now()) / 1000);
	const abs = Math.abs(diff);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	if (abs < 60) return rtf.format(Math.round(diff), "second");
	if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
	return rtf.format(Math.round(diff / 86400), "day");
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });

/**
 * Compact "how long since" for cleanup ordering — eviction ranks by
 * least-recently-used, so this is what makes that order legible.
 */
export function formatSince(iso: string | null | undefined): string {
	if (!iso) return "never";
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms)) return "—";

	const mins = Math.round(ms / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return rtf.format(-mins, "minute");
	const hours = Math.round(mins / 60);
	if (hours < 24) return rtf.format(-hours, "hour");
	const days = Math.round(hours / 24);
	return rtf.format(-days, "day");
}

/** Hours since a timestamp, for comparing against the eviction TTL. */
export function hoursSince(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const ms = Date.now() - Date.parse(iso);
	return Number.isFinite(ms) ? ms / 3_600_000 : null;
}
