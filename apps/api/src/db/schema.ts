// Doc 02 is the contract for this file. Keep them in sync.
// Postgres is snake_case, TypeScript is camelCase — Drizzle maps between them.
import { sql } from "drizzle-orm";
import {
	bigint,
	bigserial,
	boolean,
	check,
	date,
	index,
	inet,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

// ─────────────────────────────── enums ───────────────────────────────

export const torrentStatus = pgEnum("torrent_status", [
	"queued",
	"downloading",
	"paused",
	"completed",
	"errored",
	"evicted",
]);

export const playbackMode = pgEnum("playback_mode", [
	"direct", // MP4/H.264/AAC — serve raw bytes
	"remux", // container or audio wrong — ffmpeg -c:v copy -c:a aac
	"incompatible", // HEVC etc. — hand off to VLC, never transcode
	"not_media",
]);

export const shareScope = pgEnum("share_scope", ["file", "torrent"]);

/**
 * What a share_access_log row records.
 *
 *  view          — the landing page was opened
 *  download      — bytes were authorised (Caddy then serves them)
 *  denied        — refused: revoked, expired, over quota, downloads disabled
 *  unlock_failed — wrong password on a protected share
 *
 * Without this every row looked like a successful download, so "40 downloads"
 * could really be one download and 39 page loads, and a brute-force attempt
 * left no trace at all.
 */
export const shareAccessKind = pgEnum("share_access_kind", ["view", "download", "denied", "unlock_failed"]);

// ─────────────────────────────── users ───────────────────────────────

export const users = pgTable("users", {
	id: uuid("id").primaryKey(),
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash").notNull(), // argon2id
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────── refresh tokens ──────────────────────────
// The raw token is NEVER stored — only its SHA-256. `familyId` groups a
// rotation chain: replaying an already-used token revokes the whole family.

export const refreshTokens = pgTable(
	"refresh_tokens",
	{
		id: uuid("id").primaryKey(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		familyId: uuid("family_id").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		usedAt: timestamp("used_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("refresh_tokens_family_idx").on(t.familyId), index("refresh_tokens_user_idx").on(t.userId)],
);

// ────────────────────────────── torrents ─────────────────────────────

export const torrents = pgTable(
	"torrents",
	{
		id: uuid("id").primaryKey(),
		infoHash: text("info_hash").notNull(), // 40 hex, lowercase
		name: text("name").notNull(),
		magnet: text("magnet"), // redacted in logs
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		status: torrentStatus("status").notNull().default("queued"),
		progress: real("progress").notNull().default(0), // 0..1
		dlSpeedBps: bigint("dl_speed_bps", { mode: "number" }).notNull().default(0),
		upSpeedBps: bigint("up_speed_bps", { mode: "number" }).notNull().default(0),
		etaSeconds: integer("eta_seconds"),
		savePath: text("save_path"),
		pinned: boolean("pinned").notNull().default(false),
		errorMessage: text("error_message"),
		addedBy: uuid("added_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
		evictedAt: timestamp("evicted_at", { withTimezone: true }),

		// ── swarm + transfer telemetry (throttled writes — doc 04 §4) ──
		qbtState: text("qbt_state"), // raw qBittorrent state; never branch logic on it
		seedsConnected: integer("seeds_connected").notNull().default(0),
		seedsTotal: integer("seeds_total").notNull().default(0), // swarm, from tracker
		peersConnected: integer("peers_connected").notNull().default(0),
		peersTotal: integer("peers_total").notNull().default(0),
		ratio: real("ratio").notNull().default(0),
		availability: real("availability").notNull().default(0),
		downloadedBytes: bigint("downloaded_bytes", { mode: "number" }).notNull().default(0),
		uploadedBytes: bigint("uploaded_bytes", { mode: "number" }).notNull().default(0),
		wastedBytes: bigint("wasted_bytes", { mode: "number" }).notNull().default(0),
		timeActiveSeconds: integer("time_active_seconds").notNull().default(0),
		seedingTimeSeconds: integer("seeding_time_seconds").notNull().default(0),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),

		// ── static metadata (written once, when magnet metadata resolves) ──
		infoHashV2: text("info_hash_v2"),
		piecesHave: integer("pieces_have").notNull().default(0),
		piecesNum: integer("pieces_num").notNull().default(0),
		pieceSizeBytes: bigint("piece_size_bytes", { mode: "number" }),
		isPrivate: boolean("is_private").notNull().default(false),
		comment: text("comment"),
		createdByClient: text("created_by_client"),
		torrentCreatedAt: timestamp("torrent_created_at", { withTimezone: true }),
		contentPath: text("content_path"),
		category: text("category"),
		tags: text("tags").array(),
		trackerHost: text("tracker_host"),
		trackersCount: integer("trackers_count").notNull().default(0),
		dlLimitBps: bigint("dl_limit_bps", { mode: "number" }),
		upLimitBps: bigint("up_limit_bps", { mode: "number" }),
	},
	(t) => [
		uniqueIndex("torrents_info_hash_key").on(t.infoHash),
		index("torrents_status_idx").on(t.status),
		index("torrents_evict_idx").on(t.status, t.lastAccessedAt), // eviction scan
		index("torrents_added_at_idx").on(t.addedAt.desc()), // default list order
	],
);

// ──────────────────────────── torrent files ──────────────────────────

export const torrentFiles = pgTable(
	"torrent_files",
	{
		id: uuid("id").primaryKey(),
		torrentId: uuid("torrent_id")
			.notNull()
			.references(() => torrents.id, { onDelete: "cascade" }),
		qbtIndex: integer("qbt_index").notNull(), // qBittorrent addresses files by index
		path: text("path").notNull(), // relative to torrent root
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
		progress: real("progress").notNull().default(0),
		priority: smallint("priority").notNull().default(1), // 0 skip,1 normal,6 high,7 max
		isComplete: boolean("is_complete").notNull().default(false),
		contentType: text("content_type"),
	},
	(t) => [
		uniqueIndex("torrent_files_torrent_path_key").on(t.torrentId, t.path),
		index("torrent_files_torrent_idx").on(t.torrentId),
		index("torrent_files_complete_idx").on(t.torrentId, t.isComplete),
	],
);

// ───────────────────────────── media probes ──────────────────────────
// Exactly ONE ffprobe per media file, at completion. Never probe per request.

export const mediaProbes = pgTable("media_probes", {
	fileId: uuid("file_id")
		.primaryKey()
		.references(() => torrentFiles.id, { onDelete: "cascade" }),
	container: text("container"),
	videoCodec: text("video_codec"),
	audioCodec: text("audio_codec"),
	width: integer("width"),
	height: integer("height"),
	durationSeconds: real("duration_seconds"),
	bitrateBps: bigint("bitrate_bps", { mode: "number" }),
	playback: playbackMode("playback").notNull(),
	probedAt: timestamp("probed_at", { withTimezone: true }).notNull().defaultNow(),
	probeError: text("probe_error"),
});

// ─────────────────────────── torrent trackers ────────────────────────
// Persisted (unlike peers) — trackers change only on announce, ~30 min.

export const torrentTrackers = pgTable(
	"torrent_trackers",
	{
		id: uuid("id").primaryKey(),
		torrentId: uuid("torrent_id")
			.notNull()
			.references(() => torrents.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		tier: integer("tier").notNull().default(0),
		status: smallint("status").notNull(), // 0 disabled 1 not-contacted 2 working 3 updating 4 not-working
		numPeers: integer("num_peers").notNull().default(0),
		numSeeds: integer("num_seeds").notNull().default(0),
		numLeeches: integer("num_leeches").notNull().default(0),
		numDownloaded: integer("num_downloaded").notNull().default(0),
		message: text("message"),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("torrent_trackers_torrent_url_key").on(t.torrentId, t.url),
		index("torrent_trackers_torrent_idx").on(t.torrentId),
	],
);

// ─────────────────────────────── shares ──────────────────────────────
// Opaque nanoid, DB-backed, revocable. NOT an HMAC-signed URL — those cannot
// be revoked individually without rotating the secret and killing every link.

export const shares = pgTable(
	"shares",
	{
		id: text("id").primaryKey(), // nanoid(16), appears in the URL
		scope: shareScope("scope").notNull(),
		torrentId: uuid("torrent_id").references(() => torrents.id, { onDelete: "cascade" }),
		fileId: uuid("file_id").references(() => torrentFiles.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		label: text("label"),
		passwordHash: text("password_hash"), // argon2id, nullable
		allowStream: boolean("allow_stream").notNull().default(true),
		allowDownload: boolean("allow_download").notNull().default(true),
		maxBytes: bigint("max_bytes", { mode: "number" }), // null = unlimited
		bytesServed: bigint("bytes_served", { mode: "number" }).notNull().default(0),
		requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
		expiresAt: timestamp("expires_at", { withTimezone: true }), // null = never
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("shares_expires_idx").on(t.expiresAt),
		index("shares_file_idx").on(t.fileId),
		index("shares_torrent_idx").on(t.torrentId),
		check(
			"shares_scope_target_ck",
			sql`(scope = 'file'    AND file_id IS NOT NULL AND torrent_id IS NULL) OR
			    (scope = 'torrent' AND torrent_id IS NOT NULL AND file_id IS NULL)`,
		),
	],
);

// ────────────────────────── share access log ─────────────────────────

export const shareAccessLog = pgTable(
	"share_access_log",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		shareId: text("share_id")
			.notNull()
			.references(() => shares.id, { onDelete: "cascade" }),
		ip: inet("ip"),
		userAgent: text("user_agent"),
		bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
		status: smallint("status").notNull(),
		// Defaults to download so the rows written before this column existed keep
		// the meaning they had — every one of them was a successful authorisation.
		kind: shareAccessKind("kind").notNull().default("download"),
		// Why it was refused, for denied/unlock_failed. Never shown to the caller:
		// distinguishing "expired" from "no such share" is a probing oracle.
		reason: text("reason"),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("share_access_log_share_at_idx").on(t.shareId, t.at.desc()),
		index("share_access_log_at_idx").on(t.at),
		index("share_access_log_kind_idx").on(t.shareId, t.kind),
	],
);

// ─────────────────────────── external storage ────────────────────────
// One row per upload to a configured remote. rclone moves the bytes; this
// records what was asked for, what happened, and what it cost.

export const uploadStatus = pgEnum("upload_status", ["queued", "running", "completed", "failed", "cancelled"]);

/** Which way the bytes move. Restores are the same machinery in reverse. */
export const transferDirection = pgEnum("transfer_direction", ["up", "down"]);

export const uploads = pgTable(
	"uploads",
	{
		id: uuid("id").primaryKey(),
		// The rclone remote NAME, not a foreign key: remotes live in rclone's
		// config, not in this database. A row therefore outlives the remote it
		// used, which is correct — "uploaded to r2 last week" stays true after r2
		// is disconnected.
		remoteName: text("remote_name").notNull(),
		// Relative to DOWNLOADS_DIR, same coordinate space as torrent_files.path.
		srcPath: text("src_path").notNull(),
		// Where it landed, as an rclone fs string, for display and for retry.
		dstFs: text("dst_fs").notNull(),
		// The table is still called `uploads` because that is what it was built
		// for and renaming it would cost a destructive migration for a word. A
		// restore is the same row with the direction flipped and src/dst swapped:
		// same progress, same reconciler, same terminal states.
		direction: transferDirection("direction").notNull().default("up"),
		status: uploadStatus("status").notNull().default("queued"),
		// rclone's own job id. Null until the transfer has actually started, and
		// meaningless across an rclone restart — which is why terminal state is
		// reconciled rather than trusted from here.
		rcloneJobId: integer("rclone_job_id"),
		bytesTotal: bigint("bytes_total", { mode: "number" }).notNull().default(0),
		bytesDone: bigint("bytes_done", { mode: "number" }).notNull().default(0),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(t) => [
		index("uploads_created_idx").on(t.createdAt.desc()),
		index("uploads_status_idx").on(t.status),
		// One live upload per path: queueing the same folder twice would have two
		// rclone jobs writing the same destination.
		uniqueIndex("uploads_active_src_key").on(t.srcPath).where(sql`status in ('queued','running')`),
	],
);

// ─────────────────────────────── audit ───────────────────────────────
// Who changed what, and from where. Distinct from share_access_log, which
// records anonymous READS of a share link; this records OWNER-initiated writes.
//
// Deliberately not a foreign key on the target: rows must survive the thing
// they describe. "Deleted torrent X" is precisely the entry you want to still
// be there after torrent X is gone, and ON DELETE CASCADE would erase exactly
// the history worth keeping.

export const auditLog = pgTable(
	"audit_log",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		// Nullable: some auditable events have no authenticated actor yet — a
		// failed login is the obvious one, and it is the most worth recording.
		actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
		// Dotted verb: "share.create", "torrent.remove", "file.delete".
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		ip: inet("ip"),
		userAgent: text("user_agent"),
		// Free-form context — the label of a share, whether files were deleted
		// with a torrent. Never credentials; see the redaction note in doc 01.
		metadata: jsonb("metadata"),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("audit_log_at_idx").on(t.at.desc()),
		index("audit_log_action_at_idx").on(t.action, t.at.desc()),
		index("audit_log_target_idx").on(t.targetType, t.targetId),
	],
);

// ─────────────────────────────── egress ──────────────────────────────
// The free-tier guard rail. Oracle bills past 10 TB/month; budget ceiling is $0.

export const egressDaily = pgTable(
	"egress_daily",
	{
		// SURROGATE key. The original design made (day, share_id) the primary key,
		// which Postgres implicitly makes NOT NULL — so owner downloads (no share)
		// could never be recorded at all, and `ON DELETE SET NULL` on a NOT NULL
		// column would have failed the first time a share was deleted.
		id: bigserial("id", { mode: "number" }).primaryKey(),
		day: date("day").notNull(),
		// Nullable = an owner download. Deliberately NOT a foreign key.
		//
		// It was `references(shares.id, { onDelete: "set null" })`, which made
		// deleting a share IMPOSSIBLE: SET NULL rewrote the share's row to NULL,
		// which then collided with that day's existing owner row under the
		// COALESCE unique index below.
		//
		// This is accounting history. It must outlive the share it describes, so
		// the id is kept as a plain historical label — an id here that no longer
		// exists in `shares` is a normal, expected state.
		shareId: text("share_id"),
		bytesServed: bigint("bytes_served", { mode: "number" }).notNull().default(0),
	},
	(t) => [
		// COALESCE, because NULL != NULL in Postgres: a plain unique index on
		// (day, share_id) would let the owner row be inserted again every batch.
		uniqueIndex("egress_daily_day_share_key").on(t.day, sql`coalesce(${t.shareId}, '')`),
		index("egress_daily_day_idx").on(t.day),
	],
);

// ───────────────────────────── app settings ──────────────────────────

export const appSettings = pgTable("app_settings", {
	key: text("key").primaryKey(),
	value: jsonb("value").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
