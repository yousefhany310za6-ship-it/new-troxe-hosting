# Troxe Hosting — Backend

REST API for a Discord/Telegram bot hosting platform. Clients create small,
resource-limited, **fully isolated** Docker containers ("servers") that run
Node.js / Python / Bun / PHP workloads from their own persistent volume.

Stack: **NestJS 11 · TypeScript · PostgreSQL 16 (Drizzle ORM) · Docker (dockerode) · JWT**

---

## Quick start

```bash
# 1. configuration
cp .env.example .env
#    fill in the three secrets (REQUIRED in production — boot refuses otherwise):
#      openssl rand -base64 48   → JWT_ACCESS_SECRET
#      openssl rand -base64 48   → JWT_REFRESH_SECRET   (different from access)
#      openssl rand -hex 32      → ENV_ENCRYPTION_KEY    (64 hex chars, AES-256)

# 2. database
npm install
npm run db:migrate          # apply drizzle/ migrations
npm run db:seed             # seed the10 plans (free → enterprise)

# 3. run
npm run build
node dist/main.js            # or: npm run start:dev (watch mode)
```

Prerequisites: PostgreSQL ≥ 15, Docker Engine (socket access for the API user),
`iptables` with the `DOCKER-USER` chain (default Docker setup).

### Scripts

| script | purpose |
|---|---|
| `npm run build` | compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | generate migration after schema changes |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed` | seed plans |
| `npm run db:studio` | Drizzle studio |

---

## Architecture

```
src/
├── config/env.ts            # typed env parsing; fails fast on weak/missing secrets
├── common/                  # errors, filters, interceptors, pipes, crypto, password
│   ├── crypto.ts            # AES-256-GCM, sha256, timingSafeEqual helpers
│   └── password.ts          # sha256 pre-hash → bcrypt
├── db/                      # schema (9 tables), drizzle module, seed
└── modules/
    ├── auth/                # signup/login/refresh/logout, session listing
    ├── users/               # profile, password change, notifications, account delete
    ├── plans/               # public plan catalogue
    ├── servers/             # CRUD + lifecycle + observability + backups
    │   ├── provisioning/    # docker.service, sandbox.ts, images.ts,
    │   │                    # network-hardening.service, provisioner, reconciler
    │   ├── backups.service.ts
    │   └── reconciler.service.ts   # periodic drift repair + orphan GC
    ├── audit/               # append-only audit trail
    └── health/              # /health (liveness), /health/ready (deps)
```

All routes are mounted under **`/api/v1`**. Every response uses the standard
error envelope `{statusCode, code, message, requestId, path, timestamp}` and
carries an `x-request-id` header; every write is audited.

---

## Security model

### Authentication & sessions
- **Access token**: short-lived JWT (`15m`), HS256, separate secret.
- **Refresh token**: opaque `<sessionId>.<48-byte secret>` — only
  `sha256(secret)` is stored. **Single-use rotation**; replay of a rotated
  token revokes the whole family (theft detection).
- Passwords: **sha256 pre-hash → bcrypt** (default 12 rounds), so long or
  Unicode passwords can't blow past bcrypt's 72-byte limit.
- Login is **timing-equalized** (dummy hash on unknown users), with
  **progressive lockout** (`LOCKOUT_THRESHOLD`) and dedicated auth rate limits
  on top of the global limiter.

### Data protection
- Server environment variables are encrypted at rest with **AES-256-GCM**
  (`ENV_ENCRYPTION_KEY`), decrypted only in memory when building a sandbox.
- Plan / quota decisions are **server-side only** (`users.plan_id`); clients
  cannot claim a plan through the create/patch body (validation rejects it).
- All input passes `class-validator` DTOs + whitelisted pipes; PG constraint
  errors are mapped to safe HTTP codes (23505→409, 22P02→404).
- Secrets never appear in logs or error responses; boot refuses to start in
  production with missing/short/reused secrets.

### Container isolation (per server)
Every server gets its **own** container, user-defined network, and volume:

| control | value |
|---|---|
| runtime user | non-root `1000:1000` |
| root filesystem | **read-only** + `tmpfs` on `/tmp` & `/run` (`noexec,nosuid`, size-capped) |
| capabilities | `CapDrop: ALL`, `CapAdd: []`, `no-new-privileges` |
| namespaces | private IPC + cgroup ns; private PID ns (verified: ≤5 procs visible) |
| resources | per-plan CPU (`NanoCpus`), RAM + swap ceiling, `PidsLimit`, shm cap, ulimits |
| network | dedicated bridge network per server; **no published ports** (nothing is reachable from the host) |
| images | pinned allowlist only (`node:20.11-alpine`, `python:3.11-slim`, `oven/bun:1.2.4`, `php:8.3-cli`) |
| logs | `json-file` with `max-size10m × 3 files` (log reads are tail-capped) |

**Network hardening (`network-hardening.service.ts`)** — applied per server
subnet to both `DOCKER-USER` and `INPUT`, tagged `troxe:<network>` for exact
cleanup:

- **Egress filters (`DOCKER-USER`)**: DROP to `169.254.0.0/16` (cloud
  metadata), `10/8`, `172.16/12` (LAN + other docker bridges + host
  gateway), `192.168/16`, `100.64/10` (CGNAT/tailscale) and to any
  `--dst-type LOCAL` host address → a sandbox cannot reach the host, the
  LAN, other sandboxes, or instance metadata; the internet still works.
- **Ingress (`INPUT`)**: DROP everything sourced from the server's subnet →
  containers cannot talk back to any service on the host.
- Cross-client isolation comes from Docker itself (separate user-defined
  networks never bridge) **plus** these rules as defence in depth.
- Rules are idempotent, applied on provision, removed on destroy, and the
  reconciler re-applies them if they disappear.

**Verified by the integration suite** (86 checks): uid=1000, read-only rootfs,
no docker.sock, private PID ns, metadata/LAN/host unreachable, cross-client
unreachable in both directions, iptables rules present and removed on delete.

### Volume ownership
The client's data lives in a named volume mounted at `/data`
(the sandbox working directory), owned by `1000:1000` (`0750`).

> **Maintainer note — the `.troxe-init` marker:** dockerd *normalizes an
> empty volume directory back to `root:root 0755` while preparing
> `WorkingDir` (/data) during container **create** (start/restart never do
> this). The provisioning helper therefore runs
> `touch /data/.troxe-init && chown -R 1000:1000 /data && chmod 750 /data`
> **before every `createContainer`** (not only on first creation), which both
> sets ownership and keeps the directory non-empty so docker leaves it alone.
> Do not remove the marker or this ordering.

---

## Provisioning flow

`POST /servers` → `provisioner.provision()`:

1. `ensureImage` (allowlist + pull)
2. per-server network + iptables hardening (`apply`)
3. volume create → **ownership helper** (see above)
4. `createContainer` (config from `sandbox.ts`) → `start`
5. persist ids/status, audit event

Teardown (`DELETE`) is the mirror image: container → iptables cleanup →
network → volume; failures are collected and the **reconciler** (30 s tick)
GCs anything left, repairs drift (missing rules/containers), and reconciles
DB state with Docker state.

---

## API surface

| group | endpoints |
|---|---|
| `POST /auth` | `signup`, `login`, `refresh`, `logout`, `logout-all` |
| `GET /auth` | `me`, `sessions`, `active-sessions` |
| `GET/PATCH /users/me`, `POST /users/me/password`, `DELETE /users/me` | profile & account |
| `GET /plans` | public plan catalogue |
| `GET/POST /servers`, `GET/PATCH/DELETE /servers/:id` | CRUD (quota enforced) |
| `POST /servers/:id/{start,stop,restart,reinstall}` | lifecycle |
| `GET /servers/:id/{stats,usage,logs}` | metrics, disk usage, tail logs |
| `GET/POST /servers/:id/backups`, `DELETE …/backups/:backupId`, `POST …/restore` | backups (plan-gated) |
| `GET /health`, `GET /health/ready` | liveness / readiness |

Response contract: `{statusCode, code, message, requestId, path, timestamp}`
for errors; resources return plain DTOs.

---

## Testing

Integration + isolation suite (needs the API on `:3300`, Postgres container
`troxe-pg`, and Docker):

```bash
python3 tests/api_test.py      #86 checks — auth, quotas, isolation, lifecycle,
                               # backups, rate limits, cleanup
```

The suite creates its own users/servers and removes everything it creates.

---

## Operations notes

- **Migrations**: drizzle SQL in `drizzle/`; apply with `npm run db:migrate`.
  Schema changes → `npm run db:generate` first.
- **Plans**: seeded by `npm run db:seed` (idempotent). Quotas
  (`maxServers`, cpu/ram/storage) are read from the plan row at provision.
- **Backups**: tar archives under `BACKUP_DIR`, restored through a
  network-less helper container; total size capped by `BACKUP_MAX_TOTAL_MB`.
- **Reconciler**: safe to run multiple API replicas? No — run **one** API
  instance (it owns the Docker socket and iptables state).
