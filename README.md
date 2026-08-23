# Trawler

A self-hosted torrent box with a real file manager. Add torrents from anywhere,
watch them download live, browse and stream the results in your browser, mount
them as a network drive, and hand out revocable links.

Built to run on a **free-tier VPS** — it fits comfortably in 1 GB of RAM — but it
runs anywhere Docker does: Oracle Cloud, EC2, DigitalOcean, Azure, GCP, Hetzner,
or a spare machine in a cupboard.

---

## What it does

- **Add torrents in bulk** — paste many magnets at once, or drop several
  `.torrent` files. Each reports its own outcome, so one bad link does not
  discard the rest.
- **Watch progress live** — server-sent events at 1 Hz: speeds, peers, seeds, ETA.
- **Download at line speed** — bytes are served by Caddy, never proxied through
  Node. A copyable `aria2c -x16` command is offered for long-haul links.
- **Browse and stream** — a file manager over the downloads volume. Play video
  and audio in the browser, with seeking, or hand off to VLC.
- **Folder downloads** — streamed as a zip, generated on the fly.
- **Mount it** — read-only WebDAV, native on Windows, macOS and Linux.
- **Share** — revocable links with optional password, expiry and byte quota.
  Link previews render in chat apps; a locked link leaks nothing.
- **Manage storage** — see what is idle, clean up on demand. Nothing is ever
  deleted automatically unless you turn that on.
- **Stay inside your allowance** — global speed caps, seeding limits, and egress
  accounting with a hard stop, because free tiers meter outbound traffic.
- **Watch the box** — live CPU, memory, network and disk charts.

## What it is not

Not a public tracker, not a multi-tenant service, and not a media server. It is
a single-owner appliance. There is one account; the only thing other people ever
see is a share link you deliberately created.

---

## Quick start

You need Docker with the Compose plugin, and about 2 GB of free disk to begin.

```bash
git clone https://github.com/SM227465/Trawler.git
cd Trawler

cp .env.example .env
# Generate the secrets it asks for:
#   openssl rand -base64 48
$EDITOR .env

docker compose up -d
```

Open <http://localhost>, and sign in with the `OWNER_EMAIL` and `OWNER_PASSWORD`
you set in `.env`.

Database migrations apply automatically on every start — a one-shot `migrate`
service runs before the API, and a failed migration stops the deploy rather than
letting the API start against a schema it does not match.

### Deploying to a server

```bash
cp .env.example .env      # set DOMAIN, PUBLIC_BASE_URL and real secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The production overlay expects a **separate data volume mounted at `/data`**. Put
downloads on their own disk if you can: a full boot disk is what wedges a small
VPS, and it is the failure that is hardest to recover from remotely.

TLS is automatic once `DOMAIN` points at the box. See
[docs/05-deployment.md](docs/05-deployment.md) for provider-specific notes —
including the firewall rule that catches everyone, twice.

---

## Architecture

```
                    ┌─────────┐
   browser ────────▶│  Caddy  │  TLS, routing, and ALL file bytes
                    └────┬────┘
                         │  forward_auth  (is this download allowed?)
                    ┌────▼────┐
                    │   api   │  REST + SSE. Authorises; never serves bytes.
                    └──┬───┬──┘
                       │   │
          ┌────────────┘   └───────────┐
     ┌────▼─────┐               ┌──────▼──────┐
     │ postgres │               │ qBittorrent │  the actual BitTorrent client
     └────▲─────┘               └─────────────┘
          │
     ┌────┴────┐
     │ worker  │  scheduled jobs: cleanup, egress, backups
     └─────────┘
```

The load-bearing decision: **Node authorises, Caddy delivers.** A download hits
Caddy, which asks the API whether it is allowed and gets back a path. Streaming
multi-gigabyte files through the Node event loop caps throughput far below link
speed and burns CPU for nothing — measured at roughly 5× slower when we had to
do it for zip archives, which are the one unavoidable exception.

| Service | Role |
|---|---|
| `caddy` | TLS, routing, serves every downloaded byte |
| `api` | REST, SSE, authorisation, qBittorrent polling |
| `worker` | pg-boss jobs: cleanup, egress accounting, backups |
| `migrate` | one-shot; applies migrations, then exits |
| `postgres` | application data and the job queue |
| `qbittorrent` | the BitTorrent engine (WebUI never exposed) |
| `webdav` | read-only rclone WebDAV over the downloads volume |
| `web` | Next.js UI |

Design documents live in [`docs/`](docs/) — system design, database, coding
conventions, realtime, and deployment. They are written to explain *why*, not
just what.

---

## Configuration

Everything is environment variables; see [`.env.example`](.env.example) for the
full annotated list. The ones worth knowing:

| Variable | Why it matters |
|---|---|
| `PUBLIC_BASE_URL` | What share links and copyable commands point at |
| `EVICTION_ENABLED` | **Default `false`.** Nothing is ever deleted without you asking |
| `DOWNLOADS_BUDGET_BYTES` | Cap the library. `0` (default) is correct on a dedicated volume |
| `EGRESS_SOFT_ALERT_BYTES` / `EGRESS_HARD_STOP_BYTES` | Outbound allowance guard. The hard stop blocks **share** traffic only — it never locks you out of your own files |
| `TORRENTING_PORT` | Must be reachable, or every torrent reports "firewalled" |

---

## Roadmap

- **Storage backends** — S3, Google Drive, MEGA, pCloud and friends, so finished
  downloads can be pushed to storage you already pay for
- Per-torrent telemetry: peers, trackers, piece map
- Transcoding for containers browsers cannot play
- Audit log

---

## Contributing

Issues and pull requests are welcome. Two things to read first:

- [`docs/03-conventions.md`](docs/03-conventions.md) — the coding contract for
  both apps, including several rules that exist because something broke.
- The design docs explain the reasoning behind decisions that look odd. If you
  disagree with one, the doc is the thing to argue with.

```bash
cd apps/api && pnpm test        # 124 tests
cd apps/web && pnpm build
```

---

## Credit and licence

Trawler is MIT licensed — see [LICENSE](LICENSE).

The API was scaffolded from
[edwinhern/express-typescript](https://github.com/edwinhern/express-typescript),
which is MIT licensed. Its notice is retained at
[`apps/api/LICENSE.express-typescript`](apps/api/LICENSE.express-typescript).

`spike/` is kept deliberately: it is the Phase 0 proof that the Caddy download
path works, and `spike/README.md` records two findings the whole design rests on.
