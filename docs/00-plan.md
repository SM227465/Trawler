# Trawler — Build Plan

Living document. Check items off as they land. Each phase has an **exit
criterion** — do not start the next phase until it passes.

Docs: [01 system design](01-system-design.md) · [02 db](02-db-design.md) ·
[03 conventions](03-conventions.md) · [04 realtime & UI](04-realtime-and-ui.md)

---

## Phase 0 — De-risk the download path ✅ **DONE 2026-08-22**

- [x] 0.1 Minimal authz server returning `X-Accel-Path` or 403
- [x] 0.2 Caddyfile: `forward_auth` → `copy_headers` → `rewrite` → `file_server`
- [x] 0.3 Valid token streams the file; invalid returns 403
- [x] 0.4 HTTP Range requests work (seeking, resumable downloads)
- [x] 0.5 Path traversal rejected
- [x] 0.6 Throughput is native, not proxied through Node
- [x] 0.7 Working config recorded in doc 01 §5.4

**Exit:** ✅ 512 MB at 1.6 GB/s, Range correct, fails closed, no traversal.
Findings in `spike/README.md`. **`route { }` is mandatory** — a bare `handle`
reorders directives and 403s everything.

---

## Phase 1 — Infrastructure skeleton ✅ **DONE 2026-08-22**

- [x] 1.1 `docker-compose.yml`: caddy, postgres, qbittorrent
- [x] 1.2 Caddyfile (local plain HTTP; prod DuckDNS DNS-01 override)
- [x] 1.3 `.env.example` complete; `.env` gitignored
- [x] 1.4 qBittorrent seed config
- [x] 1.5 Volume layout — downloads on their own mount

**Exit:** ✅ `/healthz` 200 through Caddy; qBittorrent v5.2.3 answers only on the
compose network, 8080 refused from the host; Postgres 18.6 healthy; config
survives restart.

---

## Phase 2 — API foundation ✅ **DONE 2026-08-22**

- [x] 2.1 Scaffold `edwinhern/express-typescript` into `apps/api`
- [x] 2.2 Drizzle + pg, `schema.ts` from doc 02, first migration
- [x] 2.3 Extend `envConfig` (zod) — fail fast
- [x] 2.4 Auth: argon2id, jose, rotating refresh + family reuse detection
- [x] 2.5 Seed the single owner user
- [x] 2.6 `requireAuth`; `ServiceResponse` extended with `code` + `requestId`

**Exit:** ✅ verified through Caddy. Replaying a spent refresh token returns
`REFRESH_TOKEN_REUSED` and kills the family. No token, password or
`Authorization` header reaches the logs.

---

## Phase 3 — qBittorrent integration ✅ **DONE 2026-08-22**

- [x] 3.1 `integrations/qbittorrent` — cookie session, auto re-login, typed
- [x] 3.2 `mapState()` handling both `paused*` and `stopped*`
- [x] 3.3 `torrent` module: add / list / get / pause / resume / delete / pin
- [x] 3.4 Realtime poller in `api` (1 Hz `sync/maindata?rid`)
- [x] 3.5 Write-throttle policy (doc 04 §4)
- [x] 3.6 `GET /api/v1/events` SSE

**Exit:** ✅ Big Buck Bunny added by magnet, 264 MB to disk, live
progress/speeds/seeds/peers over SSE, deltas compressed 21 keys → 2–3,
pause/resume/pin/delete verified, delete removed row *and* files.

---

## Phase 4 — Frontend core ✅ **DONE 2026-08-22**

- [x] 4.1 Next 16 + Tailwind 4 in `apps/web` (no component library)
- [x] 4.2 `openapi-typescript` generation wired to `pnpm gen:api`
- [x] 4.3 Login page + session restore from the refresh cookie
- [x] 4.4 Torrent list (virtualized) + add-magnet
- [x] 4.5 `useTorrentStream` — SSE into the TanStack Query cache
- [x] 4.6 Per-torrent file list endpoint consumed

**Exit:** ✅ full token system (zero hard-coded colours in components),
light/dark/system with no-flash bootstrap, responsive to mobile, login →
dashboard → add magnet → live SSE. A cookie-only POST is refused.

---

## Phase 5 — The download path ✅ **DONE 2026-08-23**

- [x] 5.1 `GET /internal/authz` — traversal-safe; share-token branch marked for Phase 7
- [x] 5.2 `GET /files/:id/link`
- [x] 5.3 Wire Caddy `/dl/*` using the Phase 0 config
- [x] 5.4 Copyable `aria2c -x16 -s16` command in the UI
- [x] 5.5 Streaming ZIP for folder downloads ✅ **built 2026-08-23 on request**

**Exit:** ✅ 276 MB in 0.88 s at **313 MB/s**, sha256 identical to source.
Range requests correct (206, exact bytes). Denies: tampered token, garbage
token, no token, and an **access token replayed at `/dl`** (different audience
claim over the same secret). Fails closed — api stopped ⇒ 502, zero bytes.
`/internal/authz` is not publicly routed (404). A token is scoped to one file,
and the URL suffix is provably cosmetic: four different suffixes on one token
all returned the same 276 MB file, including one named `poster.jpg`.

**5.5 built on request** (I raised the cost first; the user asked for it anyway).

Folder downloads stream a zip from `/zip/<token>/<name>.zip`, proxied straight to
Node — Caddy cannot serve an archive that does not exist on disk. The cost is
real and measured: **60 MB/s vs 313 MB/s** for a direct file. Everything in
`zipService.ts` exists to keep it near a passthrough:

- **store, not deflate.** The payload is already-compressed video; deflating it
  burns CPU to make the output marginally BIGGER.
- **zip64 forced.** A torrent folder passes 4 GB / 65535 entries easily.
- **Max 2 concurrent**, 503 + Retry-After beyond that. Two of these is plenty on
  a 1 GB Oracle box.
- **`flush_interval -1`** in Caddy so the proxy does not buffer the stream.

Inherent limit, surfaced in the UI rather than left to surprise: no
Content-Length and no Range, so a zip **cannot be resumed**.

Download tokens now carry exactly ONE of `fid` (db row), `fp` (file path) or
`dp` (folder). A token naming two, or none, is refused — ambiguity in an
authorisation token is a bug waiting to be exploited. Verified: a file token at
`/zip` and a zip token at `/dl` both 403.

---

## Phase 6 — Storage lifecycle ✅ **DONE 2026-08-23**

> **6.1 done 2026-08-23.** pg-boss v12 owns its own `pgboss` schema (12 tables).
> `storage.evict` queue created and scheduled `*/5 * * * *`; a manual send was
> verified queued → handled → `completed`. The worker runs `pnpm start:worker`
> and, importantly, does **not** start the qBittorrent poller — that stays in
> `api` where the SSE connections are.
>
> **6.2 done 2026-08-23.** The doc 02 §4 query verbatim, 13 tests against real
> Postgres inside a rolled-back transaction — including every case doc 03 §A10
> calls non-negotiable (pinned, torrent-shared, FILE-shared, expired share,
> revoked share, pressure-overrides-TTL-but-not-pins, NULLS FIRST ordering).
> Deletion goes through `qbt.remove(hash, true)`, never `rm`.
>
> Found in the first live run: `bigint` columns come back from `db.execute()` as
> STRINGS (Drizzle's `mode:"number"` only applies to the query builder), so
> `freed += sizeBytes` was concatenating — `"0" + "276445467"`. Coerced, with a
> regression test.
>
> **6.3 done 2026-08-23.** `GET /api/v1/storage` returns disk, policy, library
> size, which pressure source (if any) is active, and — importantly — the
> torrents the NEXT pass would delete. The dashboard panel surfaces that list
> with "pin to protect", because eviction silently deleting a download is
> exactly what went wrong on the first live run. `POST /storage/evict` runs a
> pass on demand.
>
> **DESIGN CHANGE 2026-08-23 (user decision): deletion is MANUAL.**
> `EVICTION_ENABLED` defaults to **false**, so nothing is ever removed without
> the user asking. The pass still runs on its 5-minute schedule and still
> computes candidates — it just reports them as cleanup suggestions instead of
> acting. The single delete path is the explicit "Clean up now" button
> (`POST /storage/evict`, `runEviction(force=true)`), and even that honours pins
> and active shares. Automatic mode remains available as an opt-in for the
> unattended Oracle box.
>
> **6.4 done 2026-08-23.** Pinned rows carry an accent left border and an
> `aria-pressed` pin button, so protection is visible without hunting for the
> icon. Completed rows replace the meaningless ETA with "idle 3d" — the figure
> cleanup actually ranks by — and `lastAccessedAt` is now on the torrent DTO.
>
> **6.5 done 2026-08-23.** `PATCH /api/v1/storage/settings` (partial) plus a
> settings dialog. Watermarks validate as a PAIR, and a single-field patch is
> checked against the SAVED values, not just the payload — so sending
> `lowWatermarkPct: 99` alone is correctly refused against a stored high of 80.
> Settings survive a restart because they are read from the DB, not env.
>
> Corrected during 6.5: settings were first written as one nested `eviction`
> JSON blob, which contradicted doc 02's flat dotted keys (`eviction.ttlHours`,
> …) that the seed and every other group already use. Refactored to flat keys
> and the stray row deleted; `eviction.enabled` and `eviction.budgetBytes` added
> to the seed defaults.
>
> **Exit:** ✅ policy is editable from the UI, persists across restarts, and
> nothing is ever deleted without an explicit press.
>
> Gotcha: the worker service **must** set `command:` explicitly. Without it the
> container inherits the Dockerfile's `CMD ["pnpm","start:dev"]` and silently
> runs a second API, double-polling qBittorrent at 1 Hz. Caught during 6.1.

- [x] 6.1 `worker` container + pg-boss bootstrap ✅
- [x] 6.2 `storage.evict` (doc 02 §4) — deletes via qBittorrent API, never `rm` ✅
- [x] 6.3 Disk stats endpoint + UI — **from `statfs`, not qBittorrent** (see doc 02 §4) ✅
- [x] 6.4 Pin toggle + idle age in the UI ✅
- [x] 6.5 `app_settings` editable from the UI ✅

**Exit:** fill past the high watermark; disk drains itself to the low watermark
without touching a pinned torrent.

---

## Phase 6.5 — UI sections ✅ **DONE 2026-08-23** (user request)

The dashboard had grown into one stacked page. Split into sections behind a
sidebar (horizontal scroller on mobile):

- [x] **Transfers** `/` — torrent list, add, filters, sort, pagination
- [x] **Storage** `/storage` — usage, cleanup suggestions, policy
- [x] **Settings** `/settings` — global speed caps + seeding limits
- [x] **System** `/system` — load, memory, disk, service health
- [x] **Files** `/files` — in-browser file manager + read-only WebDAV ✅

The page browses the downloads volume directly: breadcrumbs, folder navigation,
per-file download, type-aware icons, size and modified time. Folders are listed
from the FILESYSTEM, not `torrent_files`, so anything on disk is reachable
whether or not it has a DB row. The WebDAV credentials moved into a collapsed
section below it — useful, but not the first thing you need.

The browsed folder lives in the URL (`/files?path=Sintel`), so a folder can be
linked and survives a reload.

**Downloads from the browser reuse the Phase 5 mechanism.** The token gained a
second claim shape: `fid` (a `torrent_files` row) or `fp` (a root-relative
path). Exactly one must be present — a token carrying both or neither is
rejected. Path tokens are containment-checked at serve time, so the token is an
authorisation, never a path oracle.

**Symlinks are now handled.** `resolveDownloadPath` normalises `..` but cannot
see through a link: a torrent containing a symlink to `/etc` would resolve to a
path that *looks* contained and then serve something else. `resolveRealPath`
calls `realpath()` first and re-checks containment against the real root.
Verified live — a link to `/etc` inside downloads is refused for both listing
and download.
- [ ] **Audit log** — needs an `audit_log` table + migration; not yet built

**Transfers is list-only.** Add moved into a modal that takes many magnets
(newline or whitespace separated, up to 50) AND many `.torrent` files (up to 20)
in one submit, reporting a per-item outcome — one bad magnet in a pasted block
must not discard the rest. Backed by `POST /torrents/batch` and
`POST /torrents/files`.

**Every view parameter is in the URL** (`q`, `status`, `sort`, `dir`, `page`,
`size`) via `useUrlState`, which uses `replace()` not `push()` so typing in the
search box does not stack history entries. Defaults are omitted from the query
string, so a pristine view has a clean URL.

**WebDAV is rclone, read-only**, behind `handle_path /webdav*` in Caddy with
rclone's own Basic auth (separate credentials — WebDAV clients speak Basic auth
and the credential gets pasted into Finder/Explorer). Read-only is deliberate:
qBittorrent owns that directory, and a writable mount would let a client delete
files behind its back, triggering a re-check or re-download. Verified: 401
without auth, 276 MB read at 165 MB/s, PUT/DELETE refused, file still on disk.

**Speed limits are an egress guard, not a nicety.** Oracle's free tier allows
10 TB outbound a month and SEEDING counts toward it. `PATCH
/api/v1/settings/transfer` writes straight through to qBittorrent
(`/transfer/setUploadLimit`, and `max_ratio` / `max_seeding_time` via
`/app/setPreferences`, which live in preferences rather than the transfer API).
The share-ratio cap is the effective control — a rate cap only slows the burn.

System memory is **cgroup-aware**: inside a container `os.totalmem()` reports the
HOST's RAM, which on a 1 GB Oracle box would be wildly wrong. Reads
`/sys/fs/cgroup/memory.max` when it is set, falls back to `os` otherwise, and
labels which one it used.

---

## Phase 7 — Shares ✅ **DONE 2026-08-23**

> **Two notions of "active", deliberately different.** `isActive()` answers "can
> this serve right now" and includes quota. `protectsFromEviction()` answers
> "may the files be deleted" and EXCLUDES quota — a share that spent its byte
> budget is one settings change from working again, and deleting the files
> underneath would make that unrecoverable. Revocation and expiry are terminal;
> a spent quota is not. This is why doc 02 §4's query checks only `revoked_at`
> and `expires_at`. Do not "fix" one to match the other; there is a test
> asserting the difference.
>
> **Quota is charged at authorisation time, not on bytes delivered.** Caddy
> serves the file, so we never see a transfer finish, and Range requests would
> under-count. Over-counting a cancelled download is the safe direction for a
> limit whose job is capping exposure.
>
> **A locked or dead link leaks nothing to a chat preview** — verified: label
> and filename appear 0 times in the raw HTML, and OG tags fall back to
> "Shared file". A password that still reveals what is behind it is decoration.
>
>
> **Owner UI done.** A `Shares` section lists active and dead links separately
> with usage, quota bar, expiry and last-used; copy and revoke per row. Creation
> happens where you already see files — a `Share` action on each completed file
> in the torrent Files dialog — rather than behind a separate picker.
>
> `allowDownload: false` is enforced at the BYTE layer, not just hidden in the
> UI: `/dl/<id>` returns 403 while the page still renders.

- [x] 7.1 `share` module — create / list / revoke, nanoid ids ✅
- [x] 7.2 `isActive()` in ONE place + its full test matrix ✅ (20 tests)
- [x] 7.3 Share tokens in `/internal/authz` + quota enforcement ✅
- [x] 7.4 Public `/s/[shareId]` — SSR, OG + Twitter meta, `noindex`, glass design ✅
- [x] 7.5 Active share ⇒ implicit pin (eviction must respect it) ✅
- [x] 7.6 Optional password on a share ✅

**Exit:** a friend on another network opens the link, sees a preview card in
chat, and downloads. Revoking kills it immediately.

---

## Phase 8 — Media playback ← **CURRENT**

> **8.2 + 8.5 done 2026-08-23 (asked for early).** A Play button on any media
> file in the Files browser and the torrent Files dialog opens a modal with a
> native `<video>` / `<audio>` / `<img>`.
>
> Seeking works because Caddy already serves with Range support — verified 206
> on a mid-file range, `Accept-Ranges: bytes`, `Content-Type: video/mp4`. A
> player without Range can only stream from the start.
>
> **Playability is guessed from the extension, and the guess is allowed to be
> wrong.** A real answer needs ffprobe (8.1), and a container proves nothing
> anyway — an .mp4 can hold HEVC that Chrome refuses. So `onError` on the media
> element is treated as a normal outcome and swaps in the VLC + copy-URL
> fallback, rather than leaving a dead black rectangle.
>
> Known-unplayable containers (mkv, avi, mov, wmv, ts…) skip the optimistic path
> and go straight to that fallback.
>
> Still open here: 8.1 ffprobe (makes the guess exact), 8.3 remux, 8.4 seek via
> `-ss`, 8.6 player on the share page.

- [ ] 8.1 `ffprobe` on completion → `media_probes`, `playback` computed once
- [x] 8.2 Direct play for MP4/H.264/AAC ✅ (+ audio and images)
- [ ] 8.3 Remux `-c:v copy -c:a aac -f mp4`, max 2 concurrent
- [ ] 8.4 Seek via ffmpeg `-ss` restart
- [x] 8.5 "Open in VLC" + copy-URL for `incompatible` ✅ (extension-based; 8.1 will make it exact)
- [ ] 8.6 Player on the share page

**Exit:** an MKV with AC3 plays in Chrome. HEVC offers VLC and never pegs CPU.

---

## Phase 9 — Full telemetry UI

- [ ] 9.1 `GET /torrents/:id/events` — properties, peers, trackers, pieces
- [ ] 9.2 Detail tabs: General, Trackers, Peers, Content
- [ ] 9.3 Piece map — RLE wire format + downsampled canvas
- [ ] 9.4 Speed graph — **load the `dataviz` skill first**
- [ ] 9.5 Column toggles persisted to `localStorage`
- [ ] 9.6 Edge cases: `metaDL`, `eta=8640000`, `availability<1`, `firewalled`
- [ ] 9.7 Re-check the bundle budget — Phase 4 already sits AT 200 KB gzip

**Exit:** parity with qBittorrent's own web UI.

---

## Phase 10 — Guard rails & production ← **CURRENT** (10.1–10.3 done)

> **10.1** Caddy had NO access log — the global `log` block configures the ERROR
> logger only, so egress accounting had nothing to read. A per-site `log`
> directive now writes JSON to a file (not stdout: the worker needs a seekable
> offset that survives its own restarts). The tailer stores that offset in
> `app_settings`, reads whole lines only, and resets to 0 on rotation —
> double-counting egress is worse than missing one file's tail.
>
> Attribution verified live: a share download landed in its own bucket, an owner
> download in the `(owner)` bucket. Re-running does not re-count; rewinding the
> offset does, proving the offset is the guard.
>
> Two `egress_daily` schema bugs found and fixed — see doc 02 §6.
>
> **10.2** The hard stop blocks SHARE traffic only. Verified: with the limit
> dropped below current usage, a share link returned 403 while an owner download
> still returned 200. Locking yourself out of your own files to protect a quota
> is a worse outcome than the overage. The check is cached for 60 s because
> `/internal/authz` runs on every byte request and aria2c opens 16 connections;
> it also fails OPEN, so a database hiccup cannot take every link down.
>
> **10.3** `pg_dump` needed PGDG in the image: Bookworm ships client 15, the
> server is 18, and pg_dump refuses to dump a server newer than itself. Verified
> 18.6 against 18.6, gzipped, 24 tables and 21 COPY blocks, 7-day retention, and
> an empty or failed dump is deleted rather than left looking like a backup.

- [x] 10.1 Caddy access-log tailer → `egress_daily` ✅
- [x] 10.2 Soft alert 8 TB / hard stop 9.5 TB on share tokens ✅
- [x] 10.3 Nightly `pg_dump` + `log.prune` ✅
- [ ] 10.4 Oracle: reserved IP, DuckDNS updater, separate block volume
- [ ] 10.5 Pay-As-You-Go with $0 budget alert (stops idle reclamation)
- [ ] 10.6 Torrent port open in **both** Security List and `iptables`
- [ ] 10.7 Uptime ping

**Exit:** running on the Oracle box, reachable at the real domain, self-managing.

---

## Working agreement

- Update this file's checkboxes as work lands.
- Update memory at `~/.claude/projects/-home-raizo-projects-cloud-torrent/memory/`
  when a phase completes or a decision changes.
- If a decision in docs 01–04 turns out wrong, **fix the doc in the same commit
  as the code**. The docs are the contract.
