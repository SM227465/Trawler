# Deployment

Trawler runs on any Docker host. This document covers the generic path first,
then the provider-specific traps.

---

## 1. What you need

- A VM with **1 GB RAM minimum** (2 GB comfortable) and Docker with the Compose
  plugin.
- A **domain pointing at the box**. Any registrar; a free DuckDNS subdomain works.
- **Ports 80 and 443 open**, plus one port for BitTorrent.
- Ideally a **second disk mounted at `/data`**.

That last one matters more than it sounds. Downloads on the boot disk means a
full boot disk, and a VM with no free space on `/` is the failure that is hardest
to recover from remotely — you often cannot even write an SSH session's temp
files.

---

## 2. First deploy

```bash
sudo mkdir -p /data/{downloads,postgres,qbittorrent,backups,caddy-logs,caddy}
sudo chown -R "$USER":"$USER" /data

git clone https://github.com/YOUR_USERNAME/trawler.git /opt/trawler
cd /opt/trawler

cp .env.example .env
$EDITOR .env
```

Set at minimum:

```bash
DOMAIN=trawler.example.com
PUBLIC_BASE_URL=https://trawler.example.com
ACME_EMAIL=you@example.com

POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 48)
REFRESH_SECRET=$(openssl rand -base64 48)
WEBDAV_PASSWORD=$(openssl rand -base64 18)

OWNER_EMAIL=you@example.com
OWNER_PASSWORD=<something long>

IMAGE_BASE=ghcr.io/YOUR_USERNAME/trawler
```

Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose exec api pnpm db:seed     # creates the owner account
```

Migrations apply themselves. A one-shot `migrate` service runs before anything
else, and `api` and `worker` wait on it *completing successfully* — so a failed
migration aborts the deploy instead of starting code against a schema it does
not match.

TLS is issued automatically on first request via HTTP-01. Nothing to configure,
no plugin needed. Watch it happen with `docker compose logs -f caddy`.

---

## 3. Automatic deploys

`.github/workflows/deploy.yml` builds images on every merge to `main`, pushes
them to GHCR, then SSHes in and restarts the stack.

Add these repository secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | server IP or hostname |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_SSH_KEY` | private key, **dedicated to deploys** |
| `DEPLOY_PATH` | e.g. `/opt/trawler` |
| `DEPLOY_DOMAIN` | your domain, for the post-deploy health check |
| `DEPLOY_PORT` | optional, defaults to 22 |

Generate the key with `ssh-keygen -t ed25519 -C trawler-deploy -f deploy_key`,
put the public half in the server's `~/.ssh/authorized_keys`, and the private
half in the secret. Do not reuse a personal key.

The server's `.env` is **never** committed and never overwritten by a deploy —
the workflow does `git reset --hard origin/main`, which leaves untracked files
alone.

### Images are built for two architectures

CI builds `linux/amd64` **and** `linux/arm64`. This is not optional if you are on
Oracle's free tier: those instances are ARM (Ampere A1), and an amd64-only image
will not start at all. The failure appears at `docker pull` on the server, long
after CI has gone green.

---

## 4. Oracle Cloud free tier

The most generous free tier available — 4 ARM cores, 24 GB RAM, 200 GB block
storage — and the one with the most traps.

**Switch the account to Pay-As-You-Go, then set a $0 budget alert.** Always Free
resources stay free either way, but Oracle reclaims idle instances on trial
accounts. This is the single most common way people lose their box.

**Open the torrent port in BOTH places.** This catches nearly everyone:

```bash
# 1. The VCN Security List / Network Security Group, in the web console
#    Ingress: 0.0.0.0/0 → TCP+UDP on your TORRENTING_PORT

# 2. The instance's own firewall, which Oracle images ship with enabled
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 51413 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 51413 -j ACCEPT
sudo netfilter-persistent save
```

Miss the second and every torrent reports "firewalled": you get outbound-only
peers, downloads crawl, and the console shows the port as open, so it looks like
a Trawler bug. It is not.

Same applies to 80 and 443.

**Mount the block volume at `/data`** rather than using the boot volume. Attach
it in the console, then follow Oracle's iSCSI attach commands, format, and add
it to `/etc/fstab`.

**Egress is capped at 10 TB/month.** Trawler counts it and hard-stops share
traffic before you exceed it, but set the speed and seeding limits in
Settings too — seeding is what quietly spends it.

---

## 5. Other providers

Nothing here is Oracle-specific. On **EC2**, **DigitalOcean**, **Azure**, **GCP**
or **Hetzner** the flow is identical:

1. Open 80, 443 and the torrent port in the provider's firewall
2. Check whether the OS image also runs its own firewall (Amazon Linux, RHEL and
   Oracle Linux do; most Debian/Ubuntu images do not)
3. Attach and mount a data volume at `/data`
4. Point your domain at the instance and deploy

Check your egress allowance and set `EGRESS_SOFT_ALERT_BYTES` /
`EGRESS_HARD_STOP_BYTES` accordingly. Most providers bill overage rather than
stopping, which is worse than a hard cap.

---

## 6. Operating it

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

**Backups** land in `/data/backups` nightly at 03:17 UTC, gzipped, 7 kept. They
are on the same machine, so copy them off periodically — a backup that dies with
the box is not a backup.

```bash
# restore
gunzip -c /data/backups/trawler-<stamp>.sql.gz | \
  docker compose exec -T postgres psql -U trawler -d trawler
```

**Cleanup is off by default.** Nothing is ever deleted unless you enable it on
the Storage page. Turn it on only when you have decided the box should manage its
own disk unattended.

**Check `/system`** for live CPU, memory, disk and network. Memory there is
cgroup-aware, so it shows the container's real limit rather than the host's total.
