import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
	HOST: z.string().min(1).default("0.0.0.0"),
	PORT: z.coerce.number().int().positive().default(3000),
	CORS_ORIGIN: z.string().url().default("http://localhost"),

	COMMON_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(1000),
	COMMON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

	// ── database ──
	DATABASE_URL: z.string().url(),

	// ── auth ──
	JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
	REFRESH_SECRET: z.string().min(32, "REFRESH_SECRET must be at least 32 chars"),
	ACCESS_TOKEN_TTL: z.string().default("15m"),
	REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
	OWNER_EMAIL: z.string().email(),
	OWNER_PASSWORD: z.string().min(8),

	// ── qBittorrent ──
	QBT_URL: z.string().url().default("http://qbittorrent:8080"),
	QBT_CATEGORY: z.string().default("trawler"),
	// Optional: the WebUI port is never published and AuthSubnetWhitelist lets
	// the api through without credentials. Set these only if that changes.
	QBT_USERNAME: z.string().optional(),
	QBT_PASSWORD: z.string().optional(),
	// ── downloads ──
	// What the copyable aria2c command and share links point at. Localhost in
	// dev; the real https origin in production.
	PUBLIC_BASE_URL: z.string().url().default("http://localhost"),
	DOWNLOADS_DIR: z.string().default("/downloads"),
	// Long enough for a multi-GB download over a slow link, including aria2c's
	// 16 parallel connections each re-authorising, and a resume after a pause.
	// Not revocable by design — that is what share links are for.
	DOWNLOAD_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(14400),

	// ── webdav ──
	WEBDAV_USER: z.string().default("trawler"),
	WEBDAV_PASSWORD: z.string().default(""),

	// ── storage policy (defaults; app_settings overrides at runtime) ──
	// OFF by default: nothing is EVER deleted without the user asking. The
	// eviction machinery still runs to SUGGEST what could be freed, but the
	// delete itself is a manual action. Opt in explicitly if you want the box
	// to manage its own disk unattended.
	EVICTION_ENABLED: z
		.string()
		.default("false")
		.transform((v) => v === "true" || v === "1"),
	// Optional cap on how much disk the torrent library may occupy.
	//
	// DEFAULT 0 (off) because production is an Oracle box with a block volume
	// DEDICATED to downloads — there the disk watermark below is the correct and
	// sufficient trigger. Set this only where the filesystem is shared with
	// unrelated data (a dev laptop), otherwise it would evict at the budget
	// while the dedicated volume still has room.
	DOWNLOADS_BUDGET_BYTES: z.coerce.number().int().min(0).default(0),
	EVICTION_TTL_HOURS: z.coerce.number().int().positive().default(48),
	EVICTION_HIGH_WATERMARK_PCT: z.coerce.number().int().min(1).max(99).default(80),
	EVICTION_LOW_WATERMARK_PCT: z.coerce.number().int().min(1).max(99).default(60),

	// ── egress guard rail ──
	CADDY_ACCESS_LOG: z.string().default("/var/log/caddy/access.log"),
	BACKUP_DIR: z.string().default("/backups"),
	EGRESS_SOFT_ALERT_BYTES: z.coerce.number().default(8_000_000_000_000),
	EGRESS_HARD_STOP_BYTES: z.coerce.number().default(9_500_000_000_000),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
	// Fail fast and loudly. A missing var must crash on boot, never surface as a
	// 500 at 2am. Values are never printed — only which keys are wrong.
	console.error("❌ Invalid environment variables:", parsedEnv.error.flatten().fieldErrors);
	throw new Error("Invalid environment variables");
}

export const env = {
	...parsedEnv.data,
	isDevelopment: parsedEnv.data.NODE_ENV === "development",
	isProduction: parsedEnv.data.NODE_ENV === "production",
	isTest: parsedEnv.data.NODE_ENV === "test",
};
