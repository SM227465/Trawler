# Trawler — System Design

Status: draft v1 · Owner: single operator · Last updated: 2026-08-22

---

## 1. Purpose

A personal put.io / TorBox equivalent. Paste a magnet, the server torrents it,
you pull the finished file to your local machine at high speed, and you can hand
a friend an expiring link to stream or download it.

Non-goals (explicit, to stop scope creep):

- Not a media library / Jellyfin replacement.
- Not multi-tenant. One owner account. Friends get links, never logins.
- Not a transcoding farm. See §6.
- No mobile app. Responsive web only.

---

## 2. Stated assumptions

The `senior-*` skills require these to be surfaced before any recommendation.
Pre-filled rather than asked one-per-turn. **Confirm the two marked ⚠.**

| # | Assumption | Value |
|---|---|---|
| 1 | Users | 1 owner + ~5 friends via share links |
| 2 | Traffic | < 50 req/min dashboard; < 5 concurrent file transfers |
| 3 | Tenancy | Single-tenant |
| 4 | Data sensitivity | Internal. No PII beyond one email + one password hash |
| 5 | Deploy cadence | On-demand, `git push` + `docker compose up -d` |
| 6 | Budget ceiling | **$0/month**, hard constraint |
| 7 | Team | 1 |
| 8 | Primary device | ⚠ Desktop-fiber for dashboard; mobile-4G for share pages |
| 9 | Host | Oracle Cloud Always Free, A1 Flex ARM64, 4 OCPU / 24 GB / 200 GB block |
| 10 | Ingress | ⚠ `<name>.duckdns.org` → reserved Oracle public IP → Caddy |

### Verifiable success criteria

Required by the Karpathy discipline in all three skills. Machine-checkable.

| Metric | Target |
|---|---|
| API latency p50 / p95 / p99 | 100 / 300 / 800 ms |
| — exempt from above | `/dl/*`, `/stream`, any ffmpeg-piped route (they are streams, not requests) |
| Dashboard LCP (desktop-fiber, p75) | < 2000 ms |
| Share page LCP (mobile-4G, p75) | < 2500 ms |
| Initial JS bundle | < 200 KB gzip |
| Per-route JS bundle | < 150 KB gzip |
| Uptime | 99% (~7h downtime/month allowed — hobby box, honest number) |
| RPO | 24 h (nightly `pg_dump` to Oracle Object Storage) |
| RTO | 2 h (`docker compose up` + restore) |
| Test coverage | ≥ 50% on `application/` + `domain/` only |
| Monthly egress | < 8 TB soft alert, 9.5 TB hard stop (Oracle free tier = 10 TB) |

---

## 3. Core principle

> **Disk is a cache, not storage.**

150 GB of usable disk with aggressive eviction behaves like unlimited capacity
for personal use. Every design decision below follows from this. At 10 TB/month
of free egress the cache can cycle ~66 times over; disk is never the bottleneck.

Corollary: **an active share is an implicit pin.** A file with a live share link
is never evicted. Wire this the same day the eviction worker is written, or a
friend clicks a link and gets a 404.

---

## 4. Component topology

Single `docker-compose.yml` on one host. No orchestrator (`internal-tool`
profile marks Kubernetes as `kill`).

```
                        Internet
                           │
                           ▼
              ┌────────────────────────┐
              │  Caddy                 │  :443
              │  · TLS (DuckDNS DNS-01)│
              │  · reverse proxy       │
              │  · file_server (bytes) │
              │  · JSON access log     │
              └───┬────────┬───────┬───┘
        /         │        │       │        /dl/*  /s/*
        │         │        │       └──────────────┐
        ▼         ▼        ▼                      ▼
   ┌────────┐ ┌───────┐ ┌──────────┐      reads /data/downloads
   │ web    │ │ api   │ │ qbit UI  │      directly (after authz)
   │ Next15 │ │ Expr5 │ │ (admin,  │
   └────────┘ └───┬───┘ │  locked) │
                  │     └────┬─────┘
                  │          │ WebAPI v2
                  │          ▼
                  │   ┌──────────────┐
                  │   │ qbittorrent  │──► /data/downloads
                  │   │ -nox         │
                  │   └──────────────┘
                  ▼
           ┌─────────────┐      ┌──────────────┐
           │ postgres 18 │◄─────│ worker       │
           │ + pg-boss   │      │ (same image  │
           └─────────────┘      │  as api)     │
                                └──────────────┘
```

### Containers

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` + duckdns plugin | TLS, proxy, **serves all file bytes** |
| `web` | built (Next.js 15) | Dashboard + public share pages |
| `api` | built (`edwinhern/express-typescript`) | REST API, forward_auth, **realtime pollers + SSE fan-out** |
| `worker` | same image as `api`, different CMD | pg-boss **durable/cron** jobs only — no realtime |
| `postgres` | `postgres:18-alpine` | App data + pg-boss queue |
| `qbittorrent` | `linuxserver/qbittorrent` (arm64) | Torrent engine |

**No Redis.** pg-boss runs the queue on Postgres. The `node-express` profile
ranks `pg-boss-or-pgmq` above `bullmq-on-redis`, and it saves a container.

### Volumes

| Path | Mounted by | Notes |
|---|---|---|
| `/data/downloads` | qbittorrent (rw), api (ro), caddy (ro) | **Separate block volume, not the boot disk.** A full boot disk is what wedges the box today. |
| `/data/postgres` | postgres | |
| `/data/config` | qbittorrent, caddy | |

---

### What the boilerplate gives us, and what we add

`edwinhern/express-typescript` is a lean API starter: Express + TS, zod env
validation, pino-http, helmet, rate limiter, Vitest + Supertest, Biome, pnpm,
`ServiceResponse` envelope, and Swagger generated from zod via zod-to-openapi.

It ships **no database, no ORM, and no authentication**. Those are our choices:

| Layer | Pick | Why |
|---|---|---|
| Database | PostgreSQL 18 | Two processes (`api` + `worker`) write concurrently. SQLite with multiple writers across a Docker volume is a real footgun — WAL over a bind mount, lock contention. Postgres is one alpine container at ~30 MB RSS on a 24 GB box. |
| ORM | Drizzle + drizzle-kit | Typed SQL, committed migrations, no codegen daemon |
| Queue / cron | pg-boss | Durable retries + cron on the DB we already run. **No Redis.** The `node-express` profile ranks `pg-boss-or-pgmq` above `bullmq-on-redis` |
| Auth | Custom: jose + argon2 | One user. Clerk/Auth0 are paid, Auth.js is Next-shaped and our auth lives in Express |

**Free win:** the boilerplate generates an OpenAPI 3 spec from its zod schemas.
Point `openapi-typescript` at it and the Next frontend gets end-to-end types
with no monorepo and no shared-package plumbing. See doc 03 §3.4.

---

## 5. Key flows

### 5.1 Add a torrent

```
FE  ──POST /api/v1/torrents { magnet }──►  API
                                            │ zod validate, parse infohash
                                            │ INSERT torrents (status=queued)
                                            ├──► qBittorrent /api/v2/torrents/add
                                            │     category=cloudtorrent
                                            │     sequentialDownload=true
                                            │     firstLastPiecePrio=true
                                            ◄── 200
FE  ◄──201 { data: torrent }────────────────┘
```

`sequentialDownload` + `firstLastPiecePrio` are set at add time, always. They
cost nothing and make partial playback possible later.

### 5.2 State sync

The **`api` container** — not the worker — polls
**`/api/v2/sync/maindata?rid=N`** every 1 s. qBittorrent's delta endpoint
returns only what changed since `rid`, so it stays cheap regardless of torrent
count. Never poll `/torrents/info`, which returns the full list every time.

**Why the api container and not the worker:** the realtime path is inherently
ephemeral and in-memory, and it must fan out to the SSE connections — which the
api container holds. Putting the poller in `worker` would force a
Postgres `LISTEN/NOTIFY` hop for every tick to reach those connections. The
worker keeps the *durable* jobs (eviction, probe, egress, backup), where
retries and cron actually matter.

(This assumes a single `api` replica. Scaling to two would require
`LISTEN/NOTIFY` fan-out. We will not scale to two.)

The poller upserts `torrents` and `torrent_files` under the write-throttle
policy in doc 04 §4, and on a torrent reaching 100% enqueues a `media.probe`
job. **Full telemetry inventory, transport design and UI spec: doc 04.**

Deliberately **not** using qBittorrent's "run external program on completion" —
it is fragile and gives no backpressure.

### 5.3 Live updates to the browser

**Server-Sent Events**, not WebSocket. Traffic is strictly server→client, SSE
passes through Caddy with no special config, and it reconnects on its own.
WebSocket would be a strictly larger surface for zero gain.

Two streams, so that expensive per-torrent telemetry is only produced while
someone is actually looking at it:

| Stream | Carries | Open when |
|---|---|---|
| `GET /api/v1/events` | global stats + torrent-list deltas | always, one per tab |
| `GET /api/v1/torrents/:id/events` | properties, peers, trackers, piece map | only while a detail view is open |

The subscription *is* the URL — no subscribe/unsubscribe protocol. Opening a
detail view opens a second `EventSource`; closing it stops the server polling
`sync/torrentPeers` and `pieceStates` for that hash. Doc 04 §3.

### 5.4 Download to local machine — the critical path

This is the product. Bytes must never pass through Node.

```
FE ──GET /api/v1/files/:id/link──► API  ──► { url: "/dl/<token>/<name>" }

Browser ──GET /dl/<token>/<name>──► Caddy
                                      │ forward_auth ──► API /internal/authz
                                      │                    · validate session OR share token
                                      │                    · check quota / expiry / revoked
                                      │                    · return X-Accel-Path
                                      │ ◄── 200 + X-Accel-Path
                                      │ rewrite → file_server(root=/data/downloads)
                                      ▼
                                  bytes at native speed, full Range support
```

Node authenticates; Caddy pushes bytes. Streaming multi-GB files through the
Node event loop caps throughput well below link speed and burns CPU for nothing.

**Verified 2026-08-22** (`spike/`) — 512 MB at 1.6 GB/s, Range requests correct,
fails closed when the API is down, traversal structurally impossible. The
working config:

```caddyfile
handle /dl/* {
	route {                          # ← route, NOT bare handle. See below.
		forward_auth api:3000 {
			uri /internal/authz
			copy_headers X-Accel-Path
		}
		rewrite * {http.request.header.X-Accel-Path}
		file_server {
			root /data/downloads
		}
	}
}
```

Two findings that cost real debugging time, both recorded in `spike/README.md`:

1. **`route` is mandatory.** Inside a bare `handle`, Caddy sorts directives by
   its own priority table, and `rewrite` outranks `forward_auth` — the rewrite
   fires first against an unset header, blanks the URI to `/`, and every request
   403s. `route` preserves written order.
2. **The URL suffix after the token is cosmetic.** Only the token selects the
   path, so traversal is structurally impossible rather than filtered. Put the
   real filename there (`/dl/<token>/Movie.2024.mkv`) and the browser names the
   download correctly with no `Content-Disposition` needed.

**Speed to the client.** A single browser TCP stream underperforms badly on
long-haul links. The file detail page must surface a copyable
`aria2c -x16 -s16 "<url>"` command — 16 parallel connections routinely gets
3–5× a browser download. Also offer streaming ZIP for whole-folder grabs
(zip on the fly, no temp file, no disk cost).

### 5.5 Share links

Opaque `nanoid(16)` primary key in `shares`, **not** an HMAC-signed URL. A
signed URL cannot be revoked without rotating the secret and killing every link
at once; a DB row can be revoked, expired, capped and audited individually.

- `GET /s/<id>` — public SSR page: name, size, player, download button, OG meta.
- `GET /dl/<id>/<name>` — the bytes, same forward_auth path as §5.4.

Defaults: expires in 7 days, `max_bytes` = 5× file size, no public index,
`X-Robots-Tag: noindex`.

### 5.6 Egress accounting

Do **not** count bytes in the forward_auth handler — video seeking fires many
Range requests and the auth handler cannot know how many bytes were actually
served. Instead a worker tails Caddy's JSON access log, sums the `size` field
per share per day into `egress_daily`, and updates `shares.bytes_served`.

At 9.5 TB in a calendar month a kill switch makes `/internal/authz` deny all
**share** tokens. Owner downloads keep working. Oracle bills past 10 TB and the
budget ceiling is $0, so this is enforced in code, not by remembering to check.

---

## 6. Media playback strategy

The single hardest part of this project. Most torrent video will not play in a
browser, and the fix is tiered.

On completion, one `ffprobe` per media file, result cached in `media_probes`.
**Never probe per request.**

| Case | Detection | Action | Cost |
|---|---|---|---|
| MP4 · H.264 · AAC | probe | serve directly via `/dl/` | zero |
| MKV · H.264 · AC3/DTS | probe | `ffmpeg -c:v copy -c:a aac -f mp4` piped to response | ~5% of one core |
| HEVC / H.265, anything exotic | probe | do **not** transcode — show "Open in VLC" + copyable URL | zero |

The middle row is the majority of real-world files, and it is a **remux, not a
re-encode**: video copied bit-for-bit, only the audio track converted.

**No HEVC transcoding, ever.** The A1 is Ampere ARM with no hardware encoder.
Software x264 on 4 Ampere cores gets roughly *one* 1080p stream at realtime with
the box pinned. VLC/mpv/Infuse play any codec natively from a plain HTTP URL at
zero server cost. Delegating is the correct engineering call; building a
transcoder is where this class of project dies.

Seeking on a remuxed stream: restart ffmpeg with `-ss <offset>`. Crude, works,
far simpler than pre-generating HLS.

---

## 7. Storage lifecycle

```
queued ──► downloading ──► completed ──► evicted
              │                │  ▲
              ├──► paused ─────┘  │
              └──► errored        └── pinned | active share ⇒ never evicted
```

`storage.evict` runs on a pg-boss cron every 5 minutes:

1. Read disk usage of `/data/downloads`.
2. Build candidate set: `status = 'completed'` AND `pinned = false`
   AND no active share AND (`completed_at + ttl < now()` OR usage > high watermark).
3. Order by `last_accessed_at ASC`.
4. Delete **through the qBittorrent API** (`/torrents/delete?deleteFiles=true`),
   never `rm` — otherwise qBittorrent's state diverges from the filesystem.
5. Mark `status = 'evicted'`, keep the row for history.

Defaults: TTL 48 h after completion, high watermark 80%, low watermark 60%.
All stored in `app_settings`, editable from the UI.

---

## 8. Security posture

| Concern | Decision |
|---|---|
| Owner auth | **Built by us** — boilerplate ships none. JWT access (15 m) + rotating opaque refresh (7 d, SHA-256 hashed) + argon2id |
| Share auth | Opaque nanoid, DB-backed, revocable, optional argon2id password |
| Transport | TLS via Caddy + Let's Encrypt, DuckDNS DNS-01 |
| Exposed ports | **443 only** (plus the torrent port, which must be reachable). Postgres is unpublished in prod; qBittorrent's WebUI is never published |
| qBittorrent auth | **None — by design.** Its WebUI port is not published, so it is reachable only from the compose network. `WebUI\AuthSubnetWhitelist` lets the api talk to it with no credentials, removing a stored secret rather than protecting an already-unreachable surface. If we ever expose that UI, it goes behind *our* auth via Caddy, not qBittorrent's |
| Headers | helmet defaults + HSTS; `X-Robots-Tag: noindex` on `/s/*` and `/dl/*` |
| CORS | Explicit allowlist, single origin |
| Input | zod at every boundary — no exceptions |
| Rate limit | On `/auth/*` and `/s/*` only |
| Secrets | env only, zod-validated at boot, fail fast |
| Log redaction | pino redacts `authorization`, `password`, **and `magnet`** (a magnet reveals content) |

---

## 9. Known risks

| Risk | Severity | Mitigation |
|---|---|---|
| ~~Caddy internal-redirect unverified~~ | ~~High~~ | **RESOLVED 2026-08-22.** Verified in `spike/`; nginx fallback not needed. See §5.4 |
| Oracle reclaims idle Always Free instance | High | Known behavior at <20% utilization over 7 days. Flip account to Pay-As-You-Go with a $0 budget alert — Always Free resources stay free and stop being reclaim-eligible |
| Boot disk fills, services wedge | High | Downloads on a separate block volume; disk alert at 80% |
| Ephemeral public IP changes | Medium | Reserved public IP (2 included in Always Free) + DuckDNS updater |
| Egress overage billed past 10 TB | Medium | Hard kill switch at 9.5 TB (§5.6) |
| ffmpeg remux pegs CPU under concurrent streams | Medium | Cap concurrent remuxes at 2; queue beyond that |
| ARM64 image availability | Low | qBittorrent, Caddy, Postgres and Node all ship arm64. Verified only on x86 so far — recheck on the Oracle box |
| Postgres 18 mount contract | Resolved | v18+ wants `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`, so data lands in a major-version subdir and `pg_upgrade --link` works. Mounting the old path makes the container restart-loop |

---

## 10. Build order

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 0 | Spike the Caddy internal-redirect | A 5 GB file downloads through `forward_auth` at full link speed |
| 1 | Compose stack + Caddy + DuckDNS TLS | `https://<name>.duckdns.org` serves a health check |
| 2 | Boilerplate + Postgres + Drizzle migrations + **auth built from scratch** + seeded owner | Login works, refresh rotation works |
| 3 | qBittorrent adapter + `qbt-sync` worker | Magnet added via API appears with live progress |
| 4 | Next dashboard: add / list / progress / per-file download | Full round trip in a browser |
| 4b | Full telemetry UI — detail tabs, peers, trackers, piece map, graphs (doc 04) | Parity with qBittorrent's own web UI |
| 5 | Eviction worker + pin + disk stats | Disk self-manages past the watermark |
| 6 | Shares: create / landing page / expiry / quota / revoke | Friend on another network downloads a file |
| 7 | `ffprobe` + direct-play + remux + "Open in VLC" | An MKV with AC3 plays in Chrome |
| 8 | Egress accounting + kill switch | `egress_daily` matches Caddy's logs |
