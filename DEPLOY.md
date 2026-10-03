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

### Backup all data (Postgres + backup archives)
```bash
# One-liner
docker run --rm -v troxe-pgdata:/pgdata -v troxe-backups:/backups -v $(pwd):/out alpine \
  sh -c "pg_dump -U postgres -d troxe -h postgres > /out/db-$(date +%F).sql && tar czf /out/backups-$(date +%F).tar.gz /backups"
```

### Restore
```bash
# 1. Stop API
docker compose stop api

# 2. Restore Postgres
cat db-2026-01-15.sql | docker exec -i troxe-postgres psql -U postgres -d troxe

# 3. Restore backup archives
tar xzf backups-2026-01-15.tar.gz -C /

# 4. Start API
docker compose start api
```

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