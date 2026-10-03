# 🚀 Troxe Hosting — Production Deployment Guide

## Quick Start (60 seconds)

```bash
# On a fresh Ubuntu 22.04/24.04 VPS (2GB+ RAM):
curl -fsSL https://raw.githubusercontent.com/yousefhany310za6-ship-it/new-troxe-hosting/main/deploy.sh | sudo bash -s -- api.yourdomain.com yourdomain.com
```

That's it. The script:
1. Installs Docker + Compose
2. Clones the repo
3. Generates **cryptographically secure secrets**
4. Builds frontend + API images
5. Starts: Postgres + API (host netns, NET_ADMIN) + Caddy (auto HTTPS)
6. Applies schema migrations on API boot (idempotent, fails the boot if broken)
7. Verifies the schema + health-checks everything

You get:
- **Frontend**: `https://yourdomain.com`
- **API**: `https://api.yourdomain.com`
- **Auto-renewing Let's Encrypt TLS**

---

## Manual Deployment (if you want control)

### 1. Prerequisites
- Ubuntu 22.04 / 24.04
- 2 GB RAM minimum (4 GB recommended)
- Domain with A record pointing to VPS IP
- Root/sudo access

### 2. Clone & Prepare
```bash
git clone https://github.com/yousefhany310za6-ship-it/new-troxe-hosting.git
cd new-troxe-hosting
cp .env.prod.template .env.prod
# Edit .env.prod — fill in DOMAIN and ALL secrets (see below)
```

### 3. Generate Secrets (one-time)
```bash
# Run these and paste into .env.prod
openssl rand -base64 32 | tr -d '=\n'    # POSTGRES_PASSWORD
openssl rand -base64 48 | tr -d '=\n'    # JWT_ACCESS_SECRET
openssl rand -base64 48 | tr -d '=\n'    # JWT_REFRESH_SECRET
openssl rand -hex 32                    # ENV_ENCRYPTION_KEY
```

### 4. Deploy
```bash
sudo ./deploy.sh api.yourdomain.com yourdomain.com
```

---

## Environment Variables (`.env.prod`)

| Variable | Description | Required |
|---|---|---|
| `DOMAIN` | Root domain (e.g., `troxe.example.com`) | ✅ |
| `POSTGRES_PASSWORD` | 32+ char base64 | ✅ |
| `JWT_ACCESS_SECRET` | 48 byte base64url | ✅ |
| `JWT_REFRESH_SECRET` | 48 byte base64url (different from access) | ✅ |
| `ENV_ENCRYPTION_KEY` | 32 byte hex | ✅ |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (default 60000) | ❌ |
| `AUTH_RATE_LIMIT_MAX` | Auth requests per window (default 8) | ❌ |
| `BACKUP_MAX_TOTAL_MB` | Total backup space per user (default 5120) | ❌ |
| `LOG_LEVEL` | `verbose\|debug\|log\|warn\|error` (default `log`) | ❌ |

**⚠️ Never commit `.env.prod` — it contains all secrets.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        INTERNET                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Caddy     │  (ports 80/443, auto HTTPS)
                    │  :80/:443   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌─────────┐ ┌──────────┐ ┌──────────┐
         │ Frontend │ │   API    │ │ Postgres │
         │  Static  │ │ :3300    │ │  :5432   │
         └─────────┘ └────┬─────┘ └──────────┘
                          │
                    ┌─────▼─────┐
                    │  Docker   │  (host netns, NET_ADMIN)
                    │  Daemon   │
                    └───────────┘
```

- **API** runs in **host network namespace** (`network_mode: host`) with `NET_ADMIN` — required for iptables hardening (DOCKER-USER/INPUT chains).
- **Postgres** isolated in internal bridge network.
- **Caddy** terminates TLS, reverse-proxies `/api/*` to API, serves static frontend.
- **Backups** persisted in `troxe-backups` volume.

---

## Updating

```bash
cd /opt/troxe-hosting
git pull
sudo ./deploy.sh api.yourdomain.com yourdomain.com
```

Zero-downtime for frontend; API restarts (~5s).

---

## Backup & Restore

Use the shipped scripts — they were proven end-to-end (dump → validate →
restore round-trip). The one-liner previously documented here used a bare
`alpine` image, which has **no `pg_dump`** and would have failed silently
on the day you needed it.

### Backup (scheduled)
```bash
# one-off
sudo PG_CONTAINER=troxe-postgres BACKUP_DIR=/var/backups/troxe-postgres \
  RETAIN_DAYS=7 ./scripts/pg-backup.sh

# daily 03:00 (root crontab)
0 3 * * * PG_CONTAINER=troxe-postgres /opt/new-troxe-hosting/scripts/pg-backup.sh >>/var/log/troxe-pg-backup.log 2>&1
```
Dumps are `pg_dump -Fc` (compressed, restorable), written `0600`, the newest
`RETAIN_DAYS` are kept, truncated/empty dumps are never published, and
overlapping runs are refused via `flock`.

> **Copy the dump off this host.** A backup that only lives on the machine it
> backs up is not a backup — `rsync`/`rclone` it to another box or object
> storage. `scripts/healthcheck.sh` alerts when dumps go stale.

### Restore (disaster)
```bash
sudo ./scripts/pg-restore.sh /var/backups/troxe-postgres/troxe-YYYYMMDD-HHMMSS.dump
```
The script validates the archive inside the container (the host needs no pg
client), takes a **pre-restore safety dump**, asks you to type the database
name, stops the API so no writes land mid-restore, and restores with
`--if-exists -c`. It does **not** restart the API: verify first, then
`docker start troxe-api`. Schema migrations re-run on API boot, so the
restored schema is re-checked automatically.

> Client files (per-server sandboxes) and `troxe-backups` archives are Docker
> volumes — back them up too:
> `docker run --rm -v troxe-backups:/b -v $(pwd):/out alpine tar czf /out/backups-$(date +%F).tar.gz /b`

---

## Monitoring & Logs

```bash
# All services
docker compose -f /opt/troxe-hosting/docker-compose.prod.yml logs -f

# API only
docker compose -f /opt/troxe-hosting/docker-compose.prod.yml logs -f api

# Health check
curl https://api.yourdomain.com/api/v1/health/ready
# {"status":"ok","checks":[{"name":"postgres","ok":true},{"name":"docker","ok":true}]}
```

### Health probe + alerting (do this — nobody reads logs at 3am)

`scripts/healthcheck.sh` checks API readiness, a **real** Postgres query,
disk %, backup freshness and container states, then alerts on failure:

```bash
# one-off
sudo PG_CONTAINER=troxe-postgres BACKUP_DIR=/var/backups/troxe-postgres \
  ALERT_WEBHOOK='https://discord.com/api/webhooks/...' ./scripts/healthcheck.sh

# every 5 minutes (root crontab)
*/5 * * * * PG_CONTAINER=troxe-postgres BACKUP_DIR=/var/backups/troxe-postgres ALERT_WEBHOOK='...' /opt/new-troxe-hosting/scripts/healthcheck.sh >>/var/log/troxe-health.log 2>&1
```

- exit codes: `0` healthy, `1` warning, `2` critical (usable by any monitor)
- alert channels: `ALERT_WEBHOOK` (any JSON POST, Discord-compatible) **or**
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- no spam: a failing check re-alerts only every `ALERT_REPEAT_H` (default 6h),
  and recovering clears the state so the next failure alerts immediately
- thresholds: `DISK_WARN=80 DISK_CRIT=90 BACKUP_MAX_AGE_H=26`

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `docker.sock` permission denied | `deploy.sh` maps socket GID via `group_add`. If manual: `usermod -aG docker $USER && newgrp docker` |
| API health `docker: false` | Check Docker daemon running; API needs host netns + NET_ADMIN |
| Caddy TLS fails | Ensure DNS A record propagated; ports 80/443 open on firewall |
| Migration errors | Migrations run on API boot — `docker compose logs api | grep -i migrat`; a failure exits the process. Never use `npx drizzle-kit migrate` in the container (drizzle-kit is a devDependency, absent from the image). |
| Port 3300 in use | API uses host port 3300; ensure nothing else binds it |

---

## Security Notes

- **Single API replica** — reconciler, auto-backups, in-memory throttle assume single ownership.
- **Non-root API** — runs as uid 1000, only docker socket group grants daemon access.
- **Digest-pinned images** — all 5 runtime images + helper pinned by SHA256.
- **Hardening** — per-container user network + volume, iptables DOCKER-USER/INPUT DROP, read-only rootfs, CapDrop ALL, no-new-privileges, pids limits.
- **Secrets** — 48-byte JWT secrets, bcrypt 12 rounds (prod floor 10), ENV_ENCRYPTION_KEY for env vars at rest.

---

## Support

- Issues: https://github.com/yousefhany310za6-ship-it/new-troxe-hosting/issues
- Audit report: `SECURITY-AUDIT-2026-09-29.md` (all 10 priority findings fixed)