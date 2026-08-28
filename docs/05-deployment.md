# Deploying Trawler

A complete walkthrough for putting Trawler on a server you control — Oracle
Cloud, EC2, DigitalOcean, Hetzner, Azure, GCP, or an old laptop in a cupboard.

**You do not need to be a developer.** You need to be comfortable copying
commands into a terminal. Every command is given in full and every one is
explained. If a step can go wrong quietly, this guide says so at the point
where it would happen, because most of these were found the hard way.

Roughly 45 minutes end to end.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Pick a server](#2-pick-a-server)
3. [First contact](#3-first-contact)
4. [Give it a data disk](#4-give-it-a-data-disk)
5. [Swap, if the box is small](#5-swap-if-the-box-is-small)
6. [Open the ports — both layers](#6-open-the-ports--both-layers)
7. [A domain name](#7-a-domain-name)
8. [Install Docker](#8-install-docker)
9. [Configure and deploy](#9-configure-and-deploy)
10. [First sign-in](#10-first-sign-in)
11. [Automatic deploys](#11-automatic-deploys)
12. [Oracle Cloud specifics](#12-oracle-cloud-specifics)
13. [Running it](#13-running-it)
14. [When something is wrong](#14-when-something-is-wrong)

---

## 1. What you need

| | |
|---|---|
| A server | 1 GB RAM minimum, 2 GB comfortable. Any Linux with Docker. |
| Disk | ~2 GB for Trawler itself, plus whatever you want to store. |
| A domain | Any registrar. A free DuckDNS subdomain is fine. |
| Ports | 80 and 443 open, plus one port for BitTorrent. |
| About 45 minutes | Most of it waiting for things to download. |

**Cost:** Trawler is free. The server is whatever you pay for it — this runs
comfortably on free tiers.

---

## 2. Pick a server

Anything that runs Docker works. Some notes that will save you time:

- **1 GB RAM is genuinely enough**, but add swap (step 5). Without it the Linux
  OOM killer eventually kills a container and you get confusing failures.
- **A separate data disk matters more than it sounds.** Downloads on the boot
  disk means a full boot disk, and a server with no free space on `/` is the
  hardest state to recover from remotely — you often cannot even open an SSH
  session, because it needs to write a temp file.
- **Check your bandwidth allowance before your disk size.** A torrent box
  spends outbound traffic, not storage. Most providers meter egress and bill
  overage; Trawler counts it and can hard-stop share traffic before you exceed
  it, but you need to know your number.

Oracle Cloud's Always Free tier is the most generous option and has the most
traps. It gets [its own section](#12-oracle-cloud-specifics).

---

## 3. First contact

Create the server with **Ubuntu 24.04** and your SSH key, then connect:

```bash
ssh -i ~/.ssh/your_key ubuntu@YOUR_SERVER_IP
```

Look at what you have:

```bash
free -h        # memory, and whether swap exists
df -h /        # disk space on the root volume
lsblk          # every disk, mounted or not
uname -m       # x86_64 or aarch64
```

Keep that output. `uname -m` matters later: Trawler publishes images for both
architectures, but knowing which you are on makes any confusion quicker to
resolve.

---

## 4. Give it a data disk

If your provider gave you a second volume, mount it at `/data`. Skip to the
directory creation at the end if you only have one disk.

`lsblk` shows an unmounted disk with no partitions — usually `sdb` or `vdb`:

```bash
lsblk
```

Format and mount it:

```bash
sudo mkfs.ext4 -m 0 -L trawler-data /dev/sdb

sudo mkdir -p /data
UUID=$(sudo blkid -s UUID -o value /dev/sdb)
echo "UUID=$UUID /data ext4 defaults,_netdev,nofail 0 2" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /data
df -h /data
```

Three details that are not cosmetic:

- **`-m 0`** removes the 5% of the filesystem ext4 reserves for root. On a
  150 GB disk that is 7.5 GB you would never see. The reserve exists to stop a
  full disk wedging system daemons, which is irrelevant on a disk holding only
  downloads.
- **Mount by UUID, not `/dev/sdb`.** Device names are assigned in detection
  order and can change between boots. A UUID cannot.
- **`nofail` is not optional.** Without it, a server whose data disk fails to
  attach drops into emergency mode with no SSH. That is not recoverable
  remotely.

Then create the directory layout:

```bash
sudo mkdir -p /data/{downloads,postgres,qbittorrent,backups,caddy-logs,caddy}
sudo chown -R "$USER":"$USER" /data
```

> **Check who uid 1000 actually is.** Containers write as uid 1000, and on most
> images that is your login user — but not all. Oracle's Ubuntu images ship a
> user called `opc` at uid 1000 and put `ubuntu` at 1001, so files your
> containers create are owned by a user you have never heard of, and directories
> you create are unwritable by them. Run `id` and `id opc 2>/dev/null`. If your
> login user is not 1000, use `sudo chown -R 1000:1000 /data` instead.

---

## 5. Swap, if the box is small

Skip if you have 2 GB of RAM or more. On a 1 GB server, do this:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -w vm.swappiness=10
free -h
```

`swappiness=10` tells the kernel to reach for swap only under real pressure
rather than pre-emptively — you want RAM spent on the page cache, not on
swapping out idle pages.

Without swap, the OOM killer eventually kills whichever container is largest.
The symptom is a service that vanished with no error in its own logs, which is
a miserable thing to debug.

---

## 6. Open the ports — both layers

**This is where most people lose an afternoon.** Cloud servers have *two*
firewalls, and they are configured in different places:

1. Your provider's firewall — security group, security list, network ACL
2. The server's own `iptables`, which several images ship enabled

Miss the second and everything looks correct in the web console while nothing
works.

### Layer 1 — your provider's firewall

Open these, from anywhere (`0.0.0.0/0`):

| Port | Protocol | Why |
|---|---|---|
| 80 | TCP | Required for the TLS certificate. Not optional even though everything redirects to HTTPS. |
| 443 | TCP | HTTPS |
| 443 | UDP | HTTP/3 |
| 6881 | TCP | BitTorrent |
| 6881 | UDP | BitTorrent DHT |

Leave SSH (22) as it is. **Do not open 8080** — qBittorrent's WebUI runs there
with no password by design, reachable only from inside Docker. Exposing it hands
over your torrent client.

### Layer 2 — the server's own firewall

First see whether one is running:

```bash
sudo iptables -L INPUT --line-numbers -n
```

If you see `Chain INPUT (policy ACCEPT)` and no rules, there is no host
firewall and you can skip ahead.

If there is a `REJECT` rule at the bottom, **note its line number** — this is
the part guides get wrong:

```
num  target     prot opt source       destination
1    ACCEPT     0    --  0.0.0.0/0    0.0.0.0/0    state RELATED,ESTABLISHED
2    ACCEPT     1    --  0.0.0.0/0    0.0.0.0/0
3    ACCEPT     0    --  0.0.0.0/0    0.0.0.0/0
4    ACCEPT     6    --  0.0.0.0/0    0.0.0.0/0    state NEW tcp dpt:22
5    REJECT     0    --  0.0.0.0/0    0.0.0.0/0    reject-with icmp-host-prohibited
```

Here it is **5**. Insert *at* that number so each new rule pushes the REJECT
down:

```bash
N=5    # ← YOUR number, not necessarily 5

sudo iptables -I INPUT $N -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT $N -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT $N -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo iptables -I INPUT $N -m state --state NEW -p tcp --dport 6881 -j ACCEPT
sudo iptables -I INPUT $N -m state --state NEW -p udp --dport 6881 -j ACCEPT

sudo iptables -L INPUT --line-numbers -n
```

**Check the output: REJECT must now be below all five.** A rule added after the
REJECT never runs, and nothing warns you. The symptom is every torrent
reporting "firewalled" while your provider's console shows the port wide open —
so it looks like a bug in Trawler. It is not.

Make them survive a reboot:

```bash
sudo netfilter-persistent save
```

If that command does not exist:

```bash
sudo apt-get update && sudo apt-get install -y iptables-persistent
```

Answer **Yes** to saving current rules.

---

## 7. A domain name

Trawler needs a domain to get an HTTPS certificate. If you have one, point an
A record at your server's IP and skip ahead.

Otherwise [DuckDNS](https://www.duckdns.org) is free: sign in, pick a
subdomain, set its IP to your server's address, and copy your token.

Then, on the server, keep it updated:

```bash
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh <<'EOF'
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=YOURSUB&token=YOURTOKEN&ip=" \
  | curl -k -o ~/duckdns/duck.log -K -
EOF

chmod 700 ~/duckdns/duck.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
~/duckdns/duck.sh && cat ~/duckdns/duck.log
```

Replace `YOURSUB` (the label only, not the full domain) and `YOURTOKEN`. It
should print `OK`. Leaving `ip=` empty makes DuckDNS use the request's source
address, so it self-corrects if your IP changes.

**Verify before going further**, from your own machine:

```bash
dig +short yoursubdomain.duckdns.org
```

That must return your server's IP. **Do not deploy until it does.** Caddy asks
Let's Encrypt for a certificate on first start, and repeated failures get you
rate-limited for hours.

---

## 8. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo systemctl enable --now docker
```

Log out and back in for the group change to apply, then check:

```bash
docker --version && docker compose version && docker run --rm hello-world
```

**Do not use `apt install docker.io`.** That is Ubuntu's older fork and it does
not ship the Compose v2 plugin, so `docker compose` will not exist and every
command below fails.

---

## 9. Configure and deploy

```bash
sudo mkdir -p /opt/trawler
sudo chown "$USER":"$USER" /opt/trawler
git clone https://github.com/SM227465/Trawler.git /opt/trawler
cd /opt/trawler
```

Generate your secrets — do not invent them by hand:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "REFRESH_SECRET=$(openssl rand -base64 48)"
echo "WEBDAV_PASSWORD=$(openssl rand -base64 18)"
echo "OWNER_PASSWORD=$(openssl rand -base64 24)"
```

> **The Postgres password is hex on purpose.** It also goes inside
> `DATABASE_URL`, which is a URL — a base64 password containing `/`, `+` or `=`
> breaks the connection string in a way that produces a confusing error a long
> way from the cause. Hex has no characters that need escaping.

Now write `.env`:

```bash
cp .env.example .env
nano .env
```

At minimum, set these:

```bash
POSTGRES_PASSWORD=<the hex one>
DATABASE_URL=postgres://trawler:<the same hex one>@postgres:5432/trawler

JWT_SECRET=<generated>
REFRESH_SECRET=<generated>
WEBDAV_PASSWORD=<generated>

OWNER_EMAIL=you@example.com
OWNER_PASSWORD=<generated — you sign in with this>

DOMAIN=yoursubdomain.duckdns.org
PUBLIC_BASE_URL=https://yoursubdomain.duckdns.org
CORS_ORIGIN=https://yoursubdomain.duckdns.org
ACME_EMAIL=you@example.com

NODE_ENV=production
TZ=Asia/Kolkata          # your timezone
IMAGE_BASE=ghcr.io/sm227465/trawler
```

Lock it down and start:

```bash
chmod 600 .env

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

First run pulls several images — a few minutes on a small box. You want to see:

- `migrate` → **Exited (0)**. That is success: it applies the database schema
  and quits. A non-zero exit means the schema did not apply, and `api` and
  `worker` deliberately refuse to start rather than run against a schema they
  do not match.
- `qbittorrent-init` → **Exited (0)**. Writes qBittorrent's configuration on
  first start only.
- everything else → **Up**

Watch the certificate get issued:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
```

`certificate obtained successfully` means you are done. `Ctrl-C` to stop
watching.

---

## 10. First sign-in

Create your account:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  exec api node dist/db/seed.js
```

It prints `owner user created`. It is safe to run again — it skips if an
account already exists.

Open `https://yourdomain` and sign in with `OWNER_EMAIL` and `OWNER_PASSWORD`.
**Change the password in the UI**; the one in `.env` is only used to seed.

Then confirm the parts that depend on the firewall actually work:

1. Add a well-seeded torrent. Ubuntu's ISO torrent is a good test.
2. On **Transfers**, look at the peers column. Connections appearing means the
   torrent port is genuinely open. If everything says "firewalled", go back to
   [step 6](#6-open-the-ports--both-layers) — it will be the host firewall.
3. On **Storage**, check the bandwidth meter.

---

## 11. Automatic deploys

Optional. Skip it if you are happy running `git pull` yourself.

If you forked the repo, GitHub Actions can build and deploy on every push.

Make a key **just for deploys** on your own machine:

```bash
ssh-keygen -t ed25519 -C trawler-deploy -f ~/.ssh/trawler_deploy -N ""
cat ~/.ssh/trawler_deploy.pub
```

Add the public half to the server:

```bash
echo 'ssh-ed25519 AAAA... trawler-deploy' >> ~/.ssh/authorized_keys
```

Then in your fork: **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | your server's IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_PATH` | `/opt/trawler` |
| `DEPLOY_DOMAIN` | your domain, for the post-deploy health check |
| `DEPLOY_SSH_KEY` | the **entire** contents of `~/.ssh/trawler_deploy` |

Include the `-----BEGIN-----` and `-----END-----` lines and the trailing
newline. A truncated key fails with an unhelpful handshake error.

Never reuse your personal SSH key. This one only needs to reach one server, and
it lives in a system you do not fully control.

Your `.env` is never touched by a deploy: the workflow runs
`git reset --hard origin/main`, which leaves untracked files alone.

---

## 12. Oracle Cloud specifics

The most generous free tier available, and the one with the most ways to lose
an afternoon. Everything above still applies; these are additional.

### Ampere may be unavailable, and the error does not say so

`VM.Standard.A1.Flex` — 4 cores, 24 GB RAM — often fails with **service limits
exceeded** on `standard-a1-core-count`. That is not a capacity shortage that
retrying will fix: **your limit is 0**, and free accounts cannot request an
increase. Only upgrading to Pay-As-You-Go lifts it.

`VM.Standard.E2.1.Micro` (1 core, 1 GB) is always available and Trawler runs on
it. Add swap.

### Pay-As-You-Go, if you can

Always Free resources stay free after upgrading. What you gain is no
idle-reclaim — Oracle reclaims idle instances on non-upgraded accounts — and
access to Ampere.

Oracle asks for a card verification of roughly USD 100 equivalent. On a credit
card that is a hold. **On a debit card the money genuinely leaves your account
for several days**, so decide accordingly. If you stay on the free tier, an
uptime monitor pinging `/healthz` every five minutes also keeps the box from
looking idle.

### Storage adds up to 200 GB total, boot volume included

A 50 GB boot volume plus a 150 GB block volume is exactly the cap. Attach the
block volume as **paravirtualized**, not iSCSI — iSCSI makes you copy three
`iscsiadm` commands onto the box and re-run them if the attachment ever drops,
and the performance difference does not matter for stored downloads.

### Reserving an IP changes it

Oracle cannot convert an ephemeral public IP to a reserved one in place. You
must set the address to **No public IP**, then edit it again and choose
**Reserved** — which allocates a *new* address. Do it before pointing DNS
anywhere. An ephemeral IP changes every time the instance stops and starts.

### uid 1000 is `opc`, not `ubuntu`

Oracle's Ubuntu images put `opc` at uid 1000 and `ubuntu` at 1001. See the note
in [step 4](#4-give-it-a-data-disk).

### Egress is 10 TB/month

Inbound is free and unmetered — downloading torrents costs nothing regardless of
volume. Outbound is what is capped: seeding, share links, your own downloads.
Trawler counts both halves and shows them on the Storage page. Set a share ratio
limit in Settings; seeding is what quietly spends the allowance.

---

## 13. Running it

Every command runs from `/opt/trawler`. That prefix is long, so:

```bash
alias trawler='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
```

```bash
trawler ps                    # what is running
trawler logs -f api           # follow the api log
trawler restart caddy         # restart one service
trawler pull && trawler up -d # update to the latest images
```

### Backups

A database dump lands in `/data/backups` nightly at 03:17 UTC, gzipped, seven
kept. **They are on the same machine, so copy them off periodically** — a backup
that dies with the box is not a backup.

```bash
# from your own machine
scp -i ~/.ssh/your_key ubuntu@SERVER:/data/backups/*.sql.gz ~/trawler-backups/
```

To restore:

```bash
gunzip -c /data/backups/trawler-<stamp>.sql.gz | \
  trawler exec -T postgres psql -U trawler -d trawler
```

Backups cover the database — your accounts, torrents, shares and settings — not
the downloaded files themselves.

### After editing the Caddyfile

**Caddy will not pick up your change on its own.** The Caddyfile is a bind
mount and Caddy reads it once at startup, so `up -d` leaves it running the old
configuration — nothing recreated the container, because its definition did not
change. `caddy reload` is not available either; the configuration sets
`admin off` deliberately.

```bash
trawler restart caddy
```

The deploy workflow does this on every deploy for exactly this reason.

---

## 14. When something is wrong

### Every torrent says "firewalled"

The host firewall, essentially always. Re-read
[step 6](#6-open-the-ports--both-layers) and check that the REJECT rule sits
*below* your ACCEPT rules.

### "qBittorrent is unavailable"

The api cannot authenticate to qBittorrent. Check the config was seeded:

```bash
grep AuthSubnetWhitelist /data/qbittorrent/qBittorrent/qBittorrent.conf
```

Two lines should come back. If nothing does, stop the container, restore it, and
start again — **stopping first is essential**, because qBittorrent rewrites its
config on shutdown and will overwrite anything you edit while it runs:

```bash
trawler stop qbittorrent
sudo cp infra/qbittorrent/qBittorrent.conf /data/qbittorrent/qBittorrent/qBittorrent.conf
sudo chown 1000:1000 /data/qbittorrent/qBittorrent/qBittorrent.conf
trawler start qbittorrent
```

### The certificate never arrives

Port 80 must be reachable from the internet, and your domain must resolve to
this server. Check both:

```bash
dig +short yourdomain
trawler logs caddy | grep -i "error\|challenge"
```

Repeated failures get rate-limited by Let's Encrypt for several hours. Fix DNS
first, then retry.

### The bandwidth meter reads zero

The worker cannot read Caddy's access log — Caddy creates it `0600` as root,
and the worker runs as uid 1000:

```bash
sudo chmod 644 /data/caddy-logs/access.log
```

New deployments handle this themselves; only boxes created before it was fixed
need the one-off chmod.

### A container keeps restarting

```bash
trawler logs --tail=50 SERVICE_NAME
free -h        # out of memory? add swap — step 5
df -h /data    # out of disk?
```

### Downloads fail with a permissions error

uid 1000 cannot write where it needs to. See the note in
[step 4](#4-give-it-a-data-disk):

```bash
ls -lan /data
sudo chown -R 1000:1000 /data/downloads /data/qbittorrent /data/backups
```

### Starting over

Nothing here deletes your downloads:

```bash
trawler down
trawler up -d
```
