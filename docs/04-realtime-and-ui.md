# Trawler — Realtime Telemetry & UI Spec

Goal: **parity with qBittorrent's own web UI**, plus what put.io / TorBox add on
top (clean file browser, share links, streaming). Everything qBittorrent knows,
the user can see.

---

## 1. The governing principle

Torrent telemetry splits into three tiers, and conflating them is what makes
these dashboards either sluggish or write-hostile.

| Tier | Examples | Persisted? | Path |
|---|---|---|---|
| **Durable** | name, size, infohash, files, status, pin, completion time | Yes, always | Postgres |
| **Throttled** | progress, ratio, downloaded/uploaded, seeds/peers counts | Yes, but rate-limited (§4) | Postgres + SSE |
| **Ephemeral** | speeds, ETA, peer list, piece map, global stats | **Never** | SSE only |

A speed reading is worthless one second later. Writing it to Postgres 50× a
second buys nothing and costs write amplification, WAL, and vacuum pressure.

---

## 2. What qBittorrent actually gives us

This bounds the UI — we can show exactly this and nothing more.

### 2.1 Endpoint inventory

| Endpoint | Gives | Poll cadence |
|---|---|---|
| `GET /sync/maindata?rid=N` | **delta** of all torrents + `server_state` | 1 s, always |
| `GET /sync/torrentPeers?hash=&rid=N` | **delta** of the peer list | 1 s, detail view only |
| `GET /torrents/properties?hash=` | detail stats not in maindata | 2 s, detail view only |
| `GET /torrents/trackers?hash=` | tracker table | 30 s, detail view only |
| `GET /torrents/webseeds?hash=` | HTTP sources | on open |
| `GET /torrents/files?hash=` | per-file progress, priority, availability | 2 s, detail view only |
| `GET /torrents/pieceStates?hash=` | `0` none / `1` downloading / `2` done, per piece | 2 s, detail view only |
| `GET /transfer/info` | global speeds (subset of `server_state`) | not needed — use `server_state` |

Both `sync/*` endpoints are **delta** endpoints: pass the previous `rid`, get
back only what changed. This is the whole reason the design is cheap. Mirror
the same idea one layer up — SSE frames carry only changed fields.

> **The delta endpoint needs a session cookie, and its name is not stable.**
> qBittorrent v4 issued `SID`; v5 issues `QBT_SID_<port>`. If the client does
> not echo whatever cookie it was given, every request opens a fresh session and
> `/sync/maindata` answers `full_update: true` with `rid` stuck at 1 — forever.
> Nothing errors; deltas just silently degrade into full snapshots. Verified
> 2026-08-22: before the fix every SSE frame carried all 21 fields, after it
> 2–3. The client stores the cookie **by value, never by name**, and qBittorrent
> issues it even on the `AuthSubnetWhitelist` bypass path where no login occurs.

### 2.2 `server_state` — the global status bar

`alltime_dl`, `alltime_ul`, `dl_info_speed`, `dl_info_data`, `up_info_speed`,
`up_info_data`, `dl_rate_limit`, `up_rate_limit`, `global_ratio`, `dht_nodes`,
`connection_status`, `free_space_on_disk`, `total_peer_connections`,
`total_wasted_session`, `queued_io_jobs`, `read_cache_hits`,
`use_alt_speed_limits`, `refresh_interval`.

Two of these earn their place beyond decoration:

- **`connection_status`** — `connected` / `firewalled` / `disconnected`.
  `firewalled` means no inbound connections, which on Oracle means the torrent
  port is not open in *both* the Security List and the instance's `iptables`.
  It is the single best diagnostic for "why is this torrent slow", and it must
  be visible in the header, not buried.
- **`free_space_on_disk`** — we get disk free from qBittorrent directly. No
  `statvfs`, no shelling out from Node.

### 2.3 Torrent states

Raw `state` values, stored verbatim in `torrents.qbt_state`:

```
error · missingFiles · uploading · stalledUP · queuedUP · checkingUP · forcedUP
allocating · downloading · metaDL · stalledDL · queuedDL · checkingDL · forcedDL
checkingResumeData · moving · unknown
pausedUP | pausedDL      (qBittorrent 4.x)
stoppedUP | stoppedDL    (qBittorrent 5.x — renamed)
```

**Normalize both spellings.** qBittorrent 5.0 renamed `paused*` → `stopped*`.
**Confirmed live:** our stack pulled **v5.2.3 (WebAPI 2.15.1)**, so we are on the
`stopped*` side today — but pin nothing and handle both, or the UI silently
shows "unknown" after an image update.

Mapping to our `status` enum:

| qbt state | our `status` |
|---|---|
| `downloading` `metaDL` `stalledDL` `queuedDL` `forcedDL` `allocating` | `downloading` |
| `checkingDL` `checkingUP` `checkingResumeData` `moving` | `downloading` (show raw state as sub-label) |
| `uploading` `stalledUP` `queuedUP` `forcedUP` | `completed` |
| `pausedDL` `stoppedDL` `pausedUP` `stoppedUP` | `paused` |
| `error` `missingFiles` | `errored` |

### 2.4 Per-torrent fields worth surfacing

From `maindata`: `name`, `size`, `total_size`, `progress`, `dlspeed`, `upspeed`,
`eta`, `state`, `num_seeds`, `num_complete`, `num_leechs`, `num_incomplete`,
`ratio`, `availability`, `downloaded`, `uploaded`, `downloaded_session`,
`uploaded_session`, `amount_left`, `time_active`, `seeding_time`,
`last_activity`, `added_on`, `completion_on`, `seen_complete`, `category`,
`tags`, `tracker`, `trackers_count`, `save_path`, `content_path`, `dl_limit`,
`up_limit`, `seq_dl`, `f_l_piece_prio`, `infohash_v1`, `infohash_v2`, `priority`.

From `properties`: `pieces_have`, `pieces_num`, `piece_size`, `nb_connections`,
`nb_connections_limit`, `total_wasted`, `dl_speed_avg`, `up_speed_avg`,
`reannounce`, `creation_date`, `created_by`, `comment`, `isPrivate`.

### 2.5 Per-peer fields

`ip`, `port`, `country`, `country_code`, `client`, `peer_id_client`,
`connection` (BT / µTP / web), `flags`, `flags_desc`, `progress`, `dl_speed`,
`up_speed`, `downloaded`, `uploaded`, `relevance`, `files`.

---

## 3. Transport

### 3.1 Two SSE streams

```
/api/v1/events                 ← always open, one per browser tab
    event: stats     → server_state delta
    event: torrents  → array of { id, ...changedFieldsOnly }
    event: removed   → array of ids

/api/v1/torrents/:id/events    ← open only while a detail view is mounted
    event: properties → changed fields only
    event: peers      → { added: {...}, changed: {...}, removed: [...] }
    event: trackers   → full array (small, changes rarely)
    event: pieces     → RLE-encoded piece states (§3.3)
```

**The subscription is the URL.** No subscribe/unsubscribe message protocol.
Mount detail view → open second `EventSource`. Unmount → close it → the server
stops polling `sync/torrentPeers` and `pieceStates` for that hash entirely.
When nobody is looking, the box does no work.

### 3.2 Deltas all the way up

The api container keeps the last emitted snapshot per torrent in memory and
diffs against it. A frame carries `id` plus only the fields that changed.

Worst case with 50 active torrents: ~200 bytes × 50 = 10 KB/s. Steady state,
where only speeds move: under 1 KB/s.

Every frame carries a monotonic `seq`. On `EventSource` reconnect the client
sends `Last-Event-ID`; if the server's buffer no longer covers that `seq` it
replies with a full snapshot and sets `full: true`. Same contract qBittorrent's
own `rid` uses — do not invent a second one.

### 3.3 Piece map encoding

A 20 GB torrent has ~10,000 pieces. Sending a 10,000-element JSON array every
2 s is absurd, and rendering 10,000 DOM nodes is worse.

- **Wire:** run-length encode as `[[state, count], …]`. A mostly-complete
  torrent compresses to a handful of pairs.
- **Render:** one `<canvas>`, downsampled to the element's pixel width. Each
  column takes the *worst* state in its bucket, so a single missing piece stays
  visible instead of being averaged away.

### 3.4 Peer list cap

Peer count can exceed 200. Send at most 200, sorted by download speed
descending, and label the table "showing top 200 of N". Nobody scrolls past
the fast ones.

---

## 4. Write-throttle policy

Persist a `torrents` row **only** when one of these is true:

1. `status` changed
2. `progress` crossed a whole percentage point
3. 30 s elapsed since that row's last write
4. the torrent completed, errored, or was removed

Speeds, ETA, connected-peer counts and availability ride tier 3 — they reach the
browser over SSE and are read from the DB **only** on a cold page load, where
being up to 30 s stale for one second is invisible.

Without this rule: 50 torrents × 1 Hz = 4.3 M writes/day. With it: a few
thousand.

Peers, piece states and `server_state` are never written at all.

---

## 5. UI specification

### 5.1 Global status bar — always visible

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ↓ 42.3 MB/s  ▁▂▄█▆▃▂  ↑ 1.2 MB/s  ▁▁▂▁▁     ● Connected   DHT: 312      │
│ Session ↓ 12.4 GB  ↑ 880 MB   Ratio 0.07    Disk 78/150 GB ▓▓▓▓▓▓▓░░     │
│ Egress 2.1 / 10 TB this month ▓▓░░░░░░░░     [ Alt speed ⚡ ]  [ + Add ]  │
└──────────────────────────────────────────────────────────────────────────┘
```

- Speed sparklines: client-side ring buffer, last 120 samples. Not persisted.
- Connection dot: green `connected` / **amber `firewalled`** / red
  `disconnected`. Amber gets a tooltip explaining the Oracle port situation.
- Disk bar turns amber at the high watermark, red above it.
- Egress bar is ours, not qBittorrent's — the free-tier guard rail made visible.

### 5.2 Torrent list

Virtualized (TanStack Virtual). Columns toggleable and persisted to
`localStorage`; sortable client-side.

| Column | Source | Default |
|---|---|---|
| Name (+ state icon, category chip) | `name`, `state` | ✅ |
| Size | `total_size` | ✅ |
| Progress | `progress` — bar + % + piece-tinted fill | ✅ |
| Status | mapped + raw sub-label | ✅ |
| Seeds | `num_seeds` **(`num_complete`)** | ✅ |
| Peers | `num_leechs` **(`num_incomplete`)** | ✅ |
| ↓ Speed / ↑ Speed | `dlspeed` / `upspeed` | ✅ |
| ETA | `eta` | ✅ |
| Ratio | `ratio` | ✅ |
| Availability | `availability` | ✅ |
| Added / Completed | `added_on` / `completion_on` | ✅ / — |
| Downloaded / Uploaded | `downloaded` / `uploaded` | — |
| Time active / Last activity | `time_active` / `last_activity` | — |
| Tracker | `tracker` host | — |
| Save path / Content path | | — |
| **TTL left** | our eviction clock | ✅ |
| **Pin / Shared** | our flags | ✅ |

Row actions: pause, resume, force resume, recheck, pin, set priority, delete
(with/without files), copy magnet, **share**, **download**.
Bulk selection for all of the above.

### 5.3 Detail view — tabs

Mirrors qBittorrent's tabs exactly, plus two of ours.

**General**

- *Transfer:* time active, ETA, connections (`nb_connections` /
  `nb_connections_limit`), seeds connected/swarm, peers connected/swarm,
  wasted, downloaded (total + session), uploaded (total + session), ↓/↑ speed
  (current + average), ↓/↑ limits, share ratio, reannounce countdown, last seen
  complete, availability.
- *Information:* total size, pieces have/total + piece size, created by, added
  on, completed on, creation date, comment, infohash v1, infohash v2, save
  path, content path, private flag, sequential download, first/last piece
  priority.

**Trackers** — tier, URL, status (colour-coded from the 0–4 enum), peers, seeds,
leeches, downloaded, message. Add/remove tracker.

**Peers** — IP, 🏳 country flag (emoji from `country_code`, no image assets),
port, client, connection type, flags + `flags_desc` tooltip, progress bar,
↓ speed, ↑ speed, downloaded, uploaded, relevance, files. Sortable.

**Content** — file tree with per-file progress, size, priority dropdown
(skip / normal / high / maximum), availability, piece range. Plus our verbs
on every completed file: **Download**, **Share**, **Play**, **Copy aria2c**.

**Pieces** — the canvas piece map (§3.3), with a legend and a
have/downloading/missing count.

**Speed** — dl/ul line chart over the session ring buffer, with an average
overlay. *(When we build this, load the `dataviz` skill first.)*

**Shares** *(ours)* — every share pointing at this torrent or its files: link,
expiry countdown, bytes served vs cap, request count, revoke button.

**Storage** *(ours)* — TTL countdown, pin toggle, "evict now", disk footprint,
and whether an active share is currently holding an implicit pin.

### 5.4 States the UI must handle

| State | Requirement |
|---|---|
| `metaDL` | Magnet metadata not resolved — **no name, no size, no files yet**. Show the infohash and a spinner, never a blank row |
| `eta = 8640000` | qBittorrent's "unknown" sentinel. Render **∞**, never "100 days" |
| `availability < 1` | No complete copy in the swarm. Badge it — this is *the* reason a torrent stalls at 97%, and users always think it is a bug |
| `checkingDL/UP`, `moving` | Long-running, no speed. Show the raw state, suppress the ETA |
| `error`, `missingFiles` | Surface qBittorrent's message verbatim |
| `firewalled` | Amber header dot + tooltip |

---

## 6. Rendering performance

The dashboard is a 1 Hz updating table, which is where React apps typically
fall over.

| Concern | Rule |
|---|---|
| List rows | TanStack Virtual. Never render 200 rows of live data |
| Re-render scope | SSE writes into the Query cache **per torrent id**. One row updating must not re-render the table |
| Sparklines & piece map | `<canvas>`, not SVG, not DOM |
| Number formatting | One memoized `Intl.NumberFormat` per unit, created once at module scope. Constructing `Intl` per cell per tick is a real, measurable cost at 1 Hz |
| Detail streams | Hard-closed on unmount. A leaked `EventSource` keeps the server polling peers forever |
| Backgrounded tab | Drop to 5 s on `visibilitychange`, or close the stream |
| Budget | The live table must not exceed **150 KB gzip** for its route (doc 03 §B8) |

---

## 7. What we deliberately do not build

| Not building | Why |
|---|---|
| RSS auto-downloader | Phase 3 at the earliest; not required for the core loop |
| Torrent creation | We consume, not publish |
| Per-torrent bandwidth scheduler | One user, one box |
| IP filter / ban list | Personal use, no abuse surface |
| Search plugin integration | Prowlarr later if wanted, not in the client |
| Persisted speed history | Ring buffer only; graphs reset on reload, by design |
