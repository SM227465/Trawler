import { inArray } from "drizzle-orm";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

export interface EvictionSettings {
	/**
	 * When false (the default) nothing is ever deleted automatically. The pass
	 * still computes candidates so the UI can suggest cleanup; acting on them is
	 * the user's decision.
	 */
	enabled: boolean;
	/** Optional cap on the library. 0 = no budget; the disk watermark governs. */
	budgetBytes: number;
	ttlHours: number;
	highWatermarkPct: number;
	lowWatermarkPct: number;
	/**
	 * Name of a configured remote, or "" for off.
	 *
	 * When set, cleanup ARCHIVES before it deletes: a torrent is copied to the
	 * remote and only removed from disk once that copy has verifiably finished.
	 * Turns the disk into a cache in front of storage the user actually owns,
	 * rather than the place data goes to die.
	 */
	archiveRemote: string;
}

/**
 * Flat dotted keys, one row per setting — the convention doc 02 §app_settings
 * specifies and the seed already uses (`share.*`, `egress.*`, `media.*` follow
 * the same shape). A nested blob per group would have been fewer writes but
 * would not match, and later phases read individual keys.
 */
const KEY = {
	enabled: "eviction.enabled",
	budgetBytes: "eviction.budgetBytes",
	ttlHours: "eviction.ttlHours",
	highWatermarkPct: "eviction.highWatermarkPct",
	lowWatermarkPct: "eviction.lowWatermarkPct",
	archiveRemote: "eviction.archiveRemote",
} as const satisfies Record<keyof EvictionSettings, string>;

const ALL_KEYS = Object.values(KEY) as string[];

const envDefaults = (): EvictionSettings => ({
	enabled: env.EVICTION_ENABLED,
	budgetBytes: env.DOWNLOADS_BUDGET_BYTES,
	ttlHours: env.EVICTION_TTL_HOURS,
	highWatermarkPct: env.EVICTION_HIGH_WATERMARK_PCT,
	lowWatermarkPct: env.EVICTION_LOW_WATERMARK_PCT,
	// No env default: this names a remote that only exists once the user has
	// configured one, so it is meaningless before then.
	archiveRemote: "",
});

export async function getEvictionSettings(): Promise<EvictionSettings> {
	const defaults = envDefaults();

	try {
		const rows = await db.select().from(appSettings).where(inArray(appSettings.key, ALL_KEYS));
		const byKey = new Map(rows.map((r) => [r.key, r.value]));

		const merged: EvictionSettings = {
			enabled: coerceBool(byKey.get(KEY.enabled), defaults.enabled),
			budgetBytes: coerceNum(byKey.get(KEY.budgetBytes), defaults.budgetBytes),
			ttlHours: coerceNum(byKey.get(KEY.ttlHours), defaults.ttlHours),
			highWatermarkPct: coerceNum(byKey.get(KEY.highWatermarkPct), defaults.highWatermarkPct),
			lowWatermarkPct: coerceNum(byKey.get(KEY.lowWatermarkPct), defaults.lowWatermarkPct),
			archiveRemote: String(byKey.get(KEY.archiveRemote) ?? defaults.archiveRemote),
		};

		// A low mark at or above the high one makes every pass try to free the
		// whole library. Refuse the stored values rather than obey them.
		if (merged.lowWatermarkPct >= merged.highWatermarkPct) {
			logger.error(
				{ low: merged.lowWatermarkPct, high: merged.highWatermarkPct },
				"invalid watermarks in app_settings — falling back to env defaults",
			);
			return defaults;
		}
		return merged;
	} catch (err) {
		logger.error({ err }, "could not read eviction settings — using env defaults");
		return defaults;
	}
}

/** Persists only the keys present in `patch`, one row each. */
export async function saveEvictionSettings(patch: Partial<EvictionSettings>): Promise<EvictionSettings> {
	const next: EvictionSettings = { ...(await getEvictionSettings()), ...patch };

	if (next.lowWatermarkPct >= next.highWatermarkPct) {
		throw new Error("lowWatermarkPct must be below highWatermarkPct");
	}

	const rows = (Object.keys(patch) as Array<keyof EvictionSettings>)
		.filter((k) => k in KEY)
		.map((k) => ({ key: KEY[k], value: next[k] as unknown as object }));

	for (const row of rows) {
		await db
			.insert(appSettings)
			.values(row)
			.onConflictDoUpdate({ target: appSettings.key, set: { value: row.value, updatedAt: new Date() } });
	}

	logger.info({ changed: rows.map((r) => r.key) }, "eviction settings updated");
	return next;
}

// jsonb round-trips as unknown; be strict about what we accept back.
function coerceNum(v: unknown, fallback: number): number {
	const n = typeof v === "string" ? Number(v) : v;
	return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function coerceBool(v: unknown, fallback: boolean): boolean {
	if (typeof v === "boolean") return v;
	if (v === "true" || v === "1") return true;
	if (v === "false" || v === "0") return false;
	return fallback;
}
