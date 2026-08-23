# Trawler — Database Design

PostgreSQL 18 · Drizzle ORM · migrations via drizzle-kit, committed to git.

---

## 1. Rules

1. **Postgres is `snake_case`, TypeScript is `camelCase`.** Drizzle maps between
   them. Never leak `snake_case` past the repository layer.
2. **UUID v7 primary keys** for entities (`gen_random_uuid()` is v4; use a v7
   helper in app code for time-ordered inserts). Exception: `shares.id` is a
   `nanoid(16)` because it appears in URLs, and `egress_daily` is keyed by date.
3. **Byte counts are `bigint`** with Drizzle `mode: 'number'`. JS safe-integer
   range covers 9 PB — far past anything we handle.
4. **Timestamps are `timestamptz`**, always UTC, named `*_at`.
5. **Every FK declares its delete behavior.** No implicit `NO ACTION`.
6. **No `SELECT *` past the repository layer.** Drizzle typed selects only.
7. Migrations are immutable once merged. Fix forward.

---

## 2. Entity relationships

```
users ──┬──< torrents ──┬──< torrent_files ──1:1── media_probes
        │               └──< torrent_trackers
        │                       │
        └──< shares >───────────┘
                │
                ├──< share_access_log
                └──< egress_daily (by day, not FK)

app_settings  (singleton key/value)
pgboss.*      (managed by pg-boss, do not touch)
```

---

## 3. Schema

### 3.1 Enums

```ts
export const torrentStatus = pgEnum('torrent_status', [
  'queued', 'downloading', 'paused', 'completed', 'errored', 'evicted',
]);

export const playbackMode = pgEnum('playback_mode', [
  'direct',        // MP4/H.264/AAC — serve raw bytes
  'remux',         // container or audio wrong — ffmpeg -c:v copy -c:a aac
  'incompatible',  // HEVC etc. — hand off to VLC, never transcode
  'not_media',
]);

export const shareScope = pgEnum('share_scope', ['file', 'torrent']);
```

### 3.2 `users`

One row. Multi-user is a non-goal, but a table costs nothing and avoids a
migration if that ever changes.

```ts
export const users = pgTable('users', {
  id:           uuid('id').primaryKey(),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),   // argon2id
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### 3.3 `refresh_tokens`

Rotating opaque refresh tokens. The raw token is **never** stored — only its
SHA-256. `familyId` groups a rotation chain: if a token that was already used
is replayed, the whole family is revoked (theft detection).

```ts
export const refreshTokens = pgTable('refresh_tokens', {
  id:        uuid('id').primaryKey(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId:  uuid('family_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),   // sha256(raw)
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt:    timestamp('used_at',    { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('refresh_tokens_family_idx').on(t.familyId),
  index('refresh_tokens_user_idx').on(t.userId),
]);
```

### 3.4 `torrents`

```ts
export const torrents = pgTable('torrents', {
  id:            uuid('id').primaryKey(),
  infoHash:      text('info_hash').notNull(),          // 40 hex, lowercase
  name:          text('name').notNull(),
  magnet:        text('magnet'),                       // redacted in logs
  sizeBytes:     bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  status:        torrentStatus('status').notNull().default('queued'),
  progress:      real('progress').notNull().default(0),        // 0..1
  dlSpeedBps:    bigint('dl_speed_bps', { mode: 'number' }).notNull().default(0),
  upSpeedBps:    bigint('up_speed_bps', { mode: 'number' }).notNull().default(0),
  etaSeconds:    integer('eta_seconds'),
  savePath:      text('save_path'),                    // absolute, inside /data/downloads
  pinned:        boolean('pinned').notNull().default(false),
  errorMessage:  text('error_message'),
  addedBy:       uuid('added_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt:       timestamp('added_at',      { withTimezone: true }).notNull().defaultNow(),
  completedAt:   timestamp('completed_at',  { withTimezone: true }),
  lastAccessedAt:timestamp('last_accessed_at', { withTimezone: true }),
  evictedAt:     timestamp('evicted_at',    { withTimezone: true }),

  // ── swarm + transfer telemetry (throttled writes — doc 04 §4) ──
  qbtState:        text('qbt_state'),                    // raw qBittorrent state, doc 04 §2.3
  seedsConnected:  integer('seeds_connected').notNull().default(0),
  seedsTotal:      integer('seeds_total').notNull().default(0),   // swarm, from tracker
  peersConnected:  integer('peers_connected').notNull().default(0),
  peersTotal:      integer('peers_total').notNull().default(0),
  ratio:           real('ratio').notNull().default(0),
  availability:    real('availability').notNull().default(0),
  downloadedBytes: bigint('downloaded_bytes', { mode: 'number' }).notNull().default(0),
  uploadedBytes:   bigint('uploaded_bytes',   { mode: 'number' }).notNull().default(0),
  wastedBytes:     bigint('wasted_bytes',     { mode: 'number' }).notNull().default(0),
  timeActiveSeconds:  integer('time_active_seconds').notNull().default(0),
  seedingTimeSeconds: integer('seeding_time_seconds').notNull().default(0),
  lastActivityAt:  timestamp('last_activity_at', { withTimezone: true }),

  // ── static metadata (written once, when magnet metadata resolves) ──
  infoHashV2:       text('info_hash_v2'),
  piecesHave:       integer('pieces_have').notNull().default(0),
  piecesNum:        integer('pieces_num').notNull().default(0),
  pieceSizeBytes:   bigint('piece_size_bytes', { mode: 'number' }),
  isPrivate:        boolean('is_private').notNull().default(false),
  comment:          text('comment'),
  createdByClient:  text('created_by_client'),
  torrentCreatedAt: timestamp('torrent_created_at', { withTimezone: true }),
  contentPath:      text('content_path'),
  category:         text('category'),
  tags:             text('tags').array(),
  trackerHost:      text('tracker_host'),
  trackersCount:    integer('trackers_count').notNull().default(0),
  dlLimitBps:       bigint('dl_limit_bps', { mode: 'number' }),
  upLimitBps:       bigint('up_limit_bps', { mode: 'number' }),
}, (t) => [
  uniqueIndex('torrents_info_hash_key').on(t.infoHash),
  index('torrents_status_idx').on(t.status),
  index('torrents_evict_idx').on(t.status, t.lastAccessedAt),   // eviction scan
  index('torrents_added_at_idx').on(t.addedAt.desc()),          // default list order
]);
```

`infoHash` is unique — adding the same magnet twice is idempotent and returns
the existing row rather than creating a duplicate.

**`status` vs `qbtState`.** `status` is *our* coarse lifecycle enum and drives
eviction, sharing and the UI's colour. `qbtState` is qBittorrent's raw
fine-grained string (`stalledDL`, `metaDL`, `checkingUP`, …), stored verbatim
for display and diagnostics. Never branch business logic on `qbtState` — map it
to `status` once, in `torrentService.mapState()`. Doc 04 §2.3.

**Speeds, ETA and connected-peer counts are only as fresh as the last throttled
write.** The live values reach the browser over SSE and are never read from the
DB. Doc 04 §4.

Rows are **never deleted on eviction**, only marked `evicted`. History is small
and re-adding an evicted torrent should be one click.

### 3.5 `torrent_files`

One row per file inside a torrent. This is what powers "grab the finished
episode while the rest of the season is still downloading."

```ts
export const torrentFiles = pgTable('torrent_files', {
  id:          uuid('id').primaryKey(),
  torrentId:   uuid('torrent_id').notNull().references(() => torrents.id, { onDelete: 'cascade' }),
  qbtIndex:    integer('qbt_index').notNull(),     // index in qBittorrent's file list
  path:        text('path').notNull(),             // relative to torrent root
  sizeBytes:   bigint('size_bytes', { mode: 'number' }).notNull(),
  progress:    real('progress').notNull().default(0),
  priority:    smallint('priority').notNull().default(1),  // 0 skip,1 normal,6 high,7 max
  isComplete:  boolean('is_complete').notNull().default(false),
  contentType: text('content_type'),
}, (t) => [
  uniqueIndex('torrent_files_torrent_path_key').on(t.torrentId, t.path),
  index('torrent_files_torrent_idx').on(t.torrentId),
  index('torrent_files_complete_idx').on(t.torrentId, t.isComplete),
]);
```

`qbtIndex` is required — qBittorrent's file-priority API addresses files by
index, not path.

### 3.6 `media_probes`

Result of exactly **one** `ffprobe` per media file, run when the file completes.
Probing per request would make every playback start slow and hammer the CPU.

```ts
export const mediaProbes = pgTable('media_probes', {
  fileId:          uuid('file_id').primaryKey()
                     .references(() => torrentFiles.id, { onDelete: 'cascade' }),
  container:       text('container'),
  videoCodec:      text('video_codec'),
  audioCodec:      text('audio_codec'),
  width:           integer('width'),
  height:          integer('height'),
  durationSeconds: real('duration_seconds'),
  bitrateBps:      bigint('bitrate_bps', { mode: 'number' }),
  playback:        playbackMode('playback').notNull(),
  probedAt:        timestamp('probed_at', { withTimezone: true }).notNull().defaultNow(),
  probeError:      text('probe_error'),
});
```

The `playback` column is computed once at probe time by the decision table in
doc 01 §6, then read on every request. Cheap.

### 3.7 `torrent_trackers`

Persisted, unlike peers. Trackers change only on announce (~30 min), so the
write cost is negligible and it lets the list view show tracker health.

```ts
export const torrentTrackers = pgTable('torrent_trackers', {
  id:            uuid('id').primaryKey(),
  torrentId:     uuid('torrent_id').notNull().references(() => torrents.id, { onDelete: 'cascade' }),
  url:           text('url').notNull(),
  tier:          integer('tier').notNull().default(0),
  status:        smallint('status').notNull(),  // 0 disabled 1 not-contacted 2 working 3 updating 4 not-working
  numPeers:      integer('num_peers').notNull().default(0),
  numSeeds:      integer('num_seeds').notNull().default(0),
  numLeeches:    integer('num_leeches').notNull().default(0),
  numDownloaded: integer('num_downloaded').notNull().default(0),
  message:       text('message'),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('torrent_trackers_torrent_url_key').on(t.torrentId, t.url),
  index('torrent_trackers_torrent_idx').on(t.torrentId),
]);
```

**Peers and piece states are deliberately NOT tables.** They change every
second, matter only while a detail view is open, and persisting them would
generate millions of writes per day for data nobody reads twice. They are
polled on demand and pushed straight over SSE. Doc 04 §3.

---

### 3.8 `shares`

Opaque, revocable, quota-capped. Deliberately **not** an HMAC-signed URL — a
signed URL cannot be revoked individually.

```ts
export const shares = pgTable('shares', {
  id:            text('id').primaryKey(),                // nanoid(16), appears in URL
  scope:         shareScope('scope').notNull(),
  torrentId:     uuid('torrent_id').references(() => torrents.id,     { onDelete: 'cascade' }),
  fileId:        uuid('file_id').references(() => torrentFiles.id,    { onDelete: 'cascade' }),
  createdBy:     uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label:         text('label'),
  passwordHash:  text('password_hash'),                  // argon2id, nullable
  allowStream:   boolean('allow_stream').notNull().default(true),
  allowDownload: boolean('allow_download').notNull().default(true),
  maxBytes:      bigint('max_bytes',     { mode: 'number' }),   // null = unlimited
  bytesServed:   bigint('bytes_served',  { mode: 'number' }).notNull().default(0),
  requestCount:  bigint('request_count', { mode: 'number' }).notNull().default(0),
  expiresAt:     timestamp('expires_at',      { withTimezone: true }),   // null = never
  revokedAt:     timestamp('revoked_at',      { withTimezone: true }),
  lastAccessedAt:timestamp('last_accessed_at',{ withTimezone: true }),
  createdAt:     timestamp('created_at',      { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('shares_expires_idx').on(t.expiresAt),
  index('shares_file_idx').on(t.fileId),
  index('shares_torrent_idx').on(t.torrentId),
  check('shares_scope_target_ck', sql`
    (scope = 'file'    AND file_id IS NOT NULL AND torrent_id IS NULL) OR
    (scope = 'torrent' AND torrent_id IS NOT NULL AND file_id IS NULL)
  `),
]);
```

Defaults set in the service layer, not the DB: `expiresAt = now() + 7 days`,
`maxBytes = 5 × file size`.

A share is **active** when `revoked_at IS NULL` AND (`expires_at IS NULL` OR
`expires_at > now()`) AND (`max_bytes IS NULL` OR `bytes_served < max_bytes`).
This predicate lives in exactly one place: `shareRepository.isActive()`.

### 3.9 `share_access_log`

Who downloaded what. Also the audit trail if a link leaks.

```ts
export const shareAccessLog = pgTable('share_access_log', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  shareId:   text('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  ip:        inet('ip'),
  userAgent: text('user_agent'),
  bytes:     bigint('bytes', { mode: 'number' }).notNull().default(0),
  status:    smallint('status').notNull(),
  at:        timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('share_access_log_share_at_idx').on(t.shareId, t.at.desc()),
  index('share_access_log_at_idx').on(t.at),
]);
```

Pruned to 30 days by a nightly job. Video seeking generates many rows — the
`egress.ingest` worker collapses them per share per day into `egress_daily`.

### 3.10 `egress_daily`

The free-tier guard rail. Oracle bills past 10 TB/month and the budget ceiling
is $0, so this is enforced in code.

```ts
export const egressDaily = pgTable('egress_daily', {
  day:         date('day').notNull(),
  shareId:     text('share_id').references(() => shares.id, { onDelete: 'set null' }),
  bytesServed: bigint('bytes_served', { mode: 'number' }).notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.day, t.shareId] }),
  index('egress_daily_day_idx').on(t.day),
]);
```

`shareId` is nullable and `ON DELETE SET NULL` — owner downloads have no share,
and a deleted share must not erase its historical egress.

Month-to-date: `SELECT sum(bytes_served) FROM egress_daily WHERE day >= date_trunc('month', now())`.
Soft alert 8 TB, hard stop 9.5 TB.

### 3.11 `app_settings`

Singleton key/value so the UI can change policy without a redeploy.

```ts
export const appSettings = pgTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Seeded keys:

| Key | Default | Meaning |
|---|---|---|
| `eviction.ttlHours` | `48` | Delete this long after completion |
| `eviction.highWatermarkPct` | `80` | Start evicting above this |
| `eviction.lowWatermarkPct` | `60` | Evict down to this |
| `share.defaultTtlHours` | `168` | 7 days |
| `share.defaultMaxBytesMultiplier` | `5` | maxBytes = 5 × filesize |
| `egress.softAlertBytes` | `8e12` | Warn |
| `egress.hardStopBytes` | `9.5e12` | Deny share tokens |
| `media.maxConcurrentRemux` | `2` | ffmpeg backpressure |

---

## 4. The eviction query

The one query worth writing by hand. Note `NOT EXISTS` rather than a partial
index — a share's active-ness depends on `now()`, which is not immutable and
therefore cannot appear in an index predicate.

```sql
SELECT t.id, t.info_hash, t.size_bytes
FROM torrents t
WHERE t.status = 'completed'
  AND t.pinned = false
  AND (
        t.completed_at < now() - ($1 || ' hours')::interval
     OR $2::boolean                                    -- disk over high watermark
  )
  AND NOT EXISTS (
        SELECT 1 FROM shares s
        WHERE (s.torrent_id = t.id OR s.file_id IN (
                 SELECT f.id FROM torrent_files f WHERE f.torrent_id = t.id))
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > now())
  )
ORDER BY t.last_accessed_at ASC NULLS FIRST
LIMIT 50;
```

Deletion goes **through the qBittorrent API** (`/torrents/delete?deleteFiles=true`),
never `rm` — otherwise qBittorrent's state diverges from the filesystem and it
re-checks or re-downloads on next start.

**Two pressure sources feed `$2` (implemented 2026-08-23).**

1. **Disk watermark** — `usedPct >= EVICTION_HIGH_WATERMARK_PCT`. This is the
   real trigger in production, where the Oracle block volume is dedicated to
   downloads.
2. **Library budget** — `DOWNLOADS_BUDGET_BYTES`, default **0 = off**. Only for
   a filesystem shared with unrelated data (a dev machine), where the disk
   percentage reflects other people's files and would fire constantly. Enabling
   it on a dedicated volume would evict while the volume still had room.

Both fall back to `EVICTION_LOW_WATERMARK_PCT`, so a pass does not stop one byte
under the threshold and re-fire five minutes later. When both trigger, the pass
frees whichever amount is larger.

**Disk figures come from `statfs(DOWNLOADS_DIR)`, not qBittorrent's
`server_state.free_space_on_disk`** as originally planned. That field reports
FREE bytes only, and a percentage watermark needs the TOTAL too, which
qBittorrent never sends. `statfs` gives both from the same filesystem, so it is
one source instead of two — and eviction keeps working when qBittorrent is
wedged. Note `bavail`, not `bfree`: the latter counts root-reserved blocks that
are not actually usable.

---

## 5. Index rationale

| Index | Serves |
|---|---|
| `torrents_info_hash_key` | Idempotent add; dedupe |
| `torrents_evict_idx (status, last_accessed_at)` | Eviction scan, §4 |
| `torrents_added_at_idx` | Default dashboard list |
| `torrent_files_torrent_path_key` | Upsert from `sync/maindata` |
| `torrent_files_complete_idx` | "Which files can I grab now?" |
| `shares_expires_idx` | Nightly expiry sweep |
| `refresh_tokens_family_idx` | Revoke a whole rotation family on reuse |
| `torrent_trackers_torrent_url_key` | Upsert on announce refresh |
| `egress_daily_day_idx` | Month-to-date sum |

Nothing else. At this row count, extra indexes cost more in write amplification
than they save. Add them when a query is actually slow, with `EXPLAIN ANALYZE`
as evidence.

---

## 6. Migrations

```bash
pnpm drizzle-kit generate     # writes ./drizzle/NNNN_name.sql — commit it
pnpm drizzle-kit migrate      # applies, runs at container start
```

Never edit a merged migration. Never use `drizzle-kit push` outside local dev.
Back up before every migration: nightly `pg_dump` gives RPO 24 h.

---

## 7. Deliberately absent

| Not doing | Why |
|---|---|
| Cursor pagination | Offset is fine under 10k rows. `internal-tool` profile |
| Soft-delete everywhere | Only `torrents` needs history |
| Audit table on every entity | One user; `share_access_log` is the only audit that matters |
| Read replicas / partitioning | Single-digit GB, single writer pair |
| Redis | pg-boss covers queue + cron |
| `peers` table | Per-second churn, read only while a detail view is open — SSE only |
| `piece_states` table | Same, and up to 10k values per torrent |
| Speed history table | Client-side ring buffer; graphs do not survive reload by design |
| Separate `sessions` table | Stateless JWT + `refresh_tokens` |

---

## 6. `egress_daily` — corrected 2026-08-23

The original design had `PRIMARY KEY (day, share_id)` with `share_id` nullable
and `ON DELETE SET NULL`. Two things were wrong with it, both only visible once
rows were actually written:

1. **A primary key column is implicitly NOT NULL in Postgres.** Owner downloads
   have no share, so they could never be recorded — the ingest job failed with
   `null value in column "share_id"` on its first real run. And `ON DELETE SET
   NULL` on a NOT NULL column would have failed the first time a share was
   deleted.

2. **`NULL != NULL`.** Even with the column nullable, a plain unique index on
   `(day, share_id)` never matches the owner row, so every ingest batch would
   INSERT a duplicate instead of accumulating.

The shape now:

```sql
id            bigserial PRIMARY KEY          -- surrogate
day           date NOT NULL
share_id      text                            -- NULL = owner download, NO FK
bytes_served  bigint NOT NULL DEFAULT 0

UNIQUE INDEX (day, COALESCE(share_id, ''))    -- the COALESCE is load-bearing
```

Upserts must target the expression — `ON CONFLICT (day, COALESCE(share_id, ''))`
— which the Drizzle query builder cannot express, so `addBytes` is raw SQL.

**`share_id` is deliberately NOT a foreign key.** With `ON DELETE SET NULL` it
was impossible to delete a share at all: SET NULL rewrote the share's row to
NULL, which then collided with that day's owner row under the unique index. This
table is accounting history and must outlive the shares it describes, so the id
is a historical label. An id here with no matching row in `shares` is normal.
