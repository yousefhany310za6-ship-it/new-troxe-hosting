# Integration Plan: Running Troxe Hosting on Stock Pterodactyl Wings

**Status:** Proposed — not started
**Date:** 2026-10-15
**Supersedes:** nothing. Complements `docs/node-agent-audit-troxe-vs-wings.md`
**Author:** engineering, from live inspection of the `new-troxe-hosting` and `pterodactyl-panel` repositories plus the running host

---

## 1. Executive Summary

The goal is to run the Troxe Hosting product on **stock, unmodified Pterodactyl Wings**.

The central finding is that this is **not a backend swap**. It is a **control-plane change**.

`troxe-api` currently owns everything: identity, billing, tickets, *and* the container
lifecycle, driving Docker directly through Dockerode. Wings inverts that relationship —
Wings executes a container configuration **pushed to it by a panel**, and has no endpoint
to create a container autonomously.

The recommended architecture is therefore a **BFF (backend-for-frontend)**:

- **Pterodactyl panel** becomes the control plane: `nodes`, `servers`, `eggs`, `allocations`,
  and the Wings configuration payload.
- **Wings** becomes the node daemon, replacing `node-agent`.
- **`troxe-api` keeps every capability Pterodactyl lacks** — users, OAuth, 2FA, billing,
  plans, tickets, announcements, audit, email — and forwards *only* server operations.
- **The frontend does not change at all.** It keeps talking to `/api/v1` on `troxe-api`.

Everything else in this document is phasing, risk, and the specific incompatibilities
that must be bridged.

### Relationship to the previous audit

`docs/node-agent-audit-troxe-vs-wings.md` §15 recommended **Option C** (keep the Troxe
node agent) and rejected Option B (fork Wings), citing "different control plane model,
significant Go work, panel-state dependency".

Two things have changed since that audit:

1. **This project explicitly wants stock Wings**, so the "significant Go work" of forking
   is avoided — at the cost of accepting the panel-state dependency, which is precisely
   what this document plans for.
2. The audit's own **Phase 3, item 1 — "Define a `NodeRuntime` interface" — has already
   been implemented** in `backend/src/modules/servers/runtime/node-runtime.ts`. The
   abstraction that a BFF migration depends on already exists.

The prior audit compared *keep-Troxe-agent* against *fork-Wings*. It did not consider
*use-stock-Wings-with-a-BFF*. That is the option evaluated here.

---

## 2. Verified Environment State

All figures below were read from the running host on 2026-10-15, not inferred from source.

### 2.1 Troxe Hosting (PostgreSQL — container `troxe-postgres`)

| Entity | Count | Detail |
|---|---|---|
| `nodes` | **1** | `id='local'`, `public_host=node.hosting.troxe.dev`, unix-socket Docker |
| `servers` | **4** | **3 `online` (live customer servers)**, 1 `suspended` |
| `users` | **4** | |
| Backend | running | `troxe-api`, `net=host`, healthy, uptime ~37h at time of writing |
| Frontend | deployed | `dist/` served by Caddy for `hosting.troxe.dev` |

> **This is a production migration, not a greenfield build.** Three customer servers are
> running. No phase below may be executed destructively against them.

### 2.2 Pterodactyl panel (MySQL — installed 2026-10-15 from `pterodactyl-panel`)

| Entity | Count |
|---|---|
| `nodes` | **0** |
| `servers` | **0** |
| `allocations` | **0** |
| `locations` | **0** |
| `users` | **1** (admin, created during install) |
| `nests` | 4 |
| `eggs` | 14 (seeded) |

**Wings is not installed on this host or any other.** `which wings` → not found.
There is currently nothing to integrate *with*.

### 2.3 Host and port map

| Port | Owner |
|---|---|
| `80`, `443` | `troxe-caddy` (host networking) — serves `hosting.troxe.dev`, `api.hosting.troxe.dev` |
| `3300` | `troxe-api` (host networking) |
| `8080` | **nginx — the Pterodactyl panel vhost installed 2026-10-15** |
| `5432` | `troxe-postgres` (loopback only) |
| `2022` | **free** |
| `8081` | **free** |

**Port collision:** Wings defaults its API to `8080`, which is now taken by the panel.
Wings must be moved to `8081` with SFTP on `2022`. This is a configuration change, not an
obstacle, but it must be explicit — Wings and the panel cannot share `8080`.

### 2.4 Frontend stack comparison

| | `new-troxe-hosting` | `pterodactyl-panel` |
|---|---|---|
| React | **19.3** | **16.14** |
| Router | `react-router-dom` 7.18 | 5.1.2 |
| Language | JavaScript (JSX) | **TypeScript 5.1** |
| Tailwind | **4.3** + shadcn tokens | 3.0 |
| Build | Vite 5 | Webpack 5 |
| Size | 32,752 LOC / 200 files | — |

`new-troxe-hosting` also ships a reusable UI kit: `src/components/ui/` (17 components —
modal, sheet, select, input-otp, password-strength, confirm-modal) built on a monochrome
token set (pure black surfaces, hairline borders, white accent) in `src/index.css`.
This design system is portable to the Pterodactyl frontend independently of the Wings
question — see §8.3.

---

## 3. Why a Direct `Dockerode → Wings` Swap Is Not Possible

### 3.1 `NodeRuntime` is Docker-shaped

`backend/src/modules/servers/runtime/node-runtime.ts`:

```ts
export interface NodeRuntime {
  createContainer(opts: ContainerCreateOptions): Promise<string>;   // ← dockerode type
  start(id: string): Promise<void>;
  stop(id: string, timeoutSec?: number): Promise<void>;
  restart(id: string, timeoutSec?: number): Promise<void>;
  remove(id: string, force?: boolean): Promise<void>;
  inspect(id: string): Promise<ContainerState | null>;
  stats(id: string): Promise<ContainerStats | null>;
}
```

### 3.2 Method-by-method against the real Wings API

The Wings endpoints below are the ones the panel actually calls, enumerated from
`app/Repositories/Wings/*.php`:

| `NodeRuntime` method | Wings equivalent | Verdict |
|---|---|---|
| `createContainer(ContainerCreateOptions)` | `POST /api/servers` + `POST /api/servers/{uuid}/sync` | ❌ **No equivalent.** Wings builds the container from an egg config + allocations + limits + environment pushed by the panel. A `HostConfig` is not a Wings input. |
| `start` / `stop` / `restart` | `POST /api/servers/{uuid}/power` | ✅ Direct |
| `remove` | `DELETE /api/servers/{uuid}` | ⚠️ Approximate — deletes the Wings-managed instance, not a Docker container by ID |
| `inspect` | — | ❌ No endpoint. Closest is the node-level server list |
| `stats` | `WS /api/servers/{uuid}/websocket` | ⚠️ **Streaming only.** No REST equivalent; requires a persistent WebSocket per server |

### 3.3 Authentication model

From `app/Repositories/Wings/DaemonRepository.php:59` and
`app/Http/Controllers/Api/Client/Servers/WebsocketController.php`:

```php
// REST — node-scoped bearer token
'Authorization' => 'Bearer ' . $this->node->getDecryptedKey(),

// Console — the panel mints a ONE-TIME JWT per websocket connection
```

Consequences for `troxe-api`:

- To call Wings, it needs the node's **decrypted `daemon_token`**. That value lives in the
  panel's `nodes` table, encrypted with the panel's `APP_KEY`. `troxe-api` therefore
  cannot hold it independently — it must be fetched through the panel API or the panel DB.
- The console cannot reuse a long-lived token. Every connection requires a fresh
  panel-issued JWT. `exec.gateway.ts` (socket.io, shared token) does not map.

### 3.4 The decisive constraint

> **Wings has no autonomous container-creation API.** A container exists only after the
> panel pushes a full server configuration to it.

This is why "swap the Docker client for a Wings client inside `troxe-api`" is not a
refactor — it is a reimplementation of the panel. Feeding Wings correctly requires the
`nodes`, `servers`, `eggs`, `allocations`, and `users` tables to already exist and be
correct in the panel.

---

## 4. Recommended Architecture — BFF

```
                         ┌──────────────────────────────────────────┐
  Browser  ─────────────▶│  troxe-api  (NestJS + PostgreSQL, :3300) │
   (unchanged SPA)       │                                          │
                         │  KEEPS:  users · OAuth · 2FA · billing   │
                         │          plans · tickets · announcements │
                         │          audit · email · admin tooling    │
                         │                                          │
                         │  SERVER OPS ── forwarded ────────────────┼──▶ Pterodactyl panel API
                         └──────────────────────────────────────────┘        (MySQL)
                                                                                     │
                                                                          owns nodes / servers
                                                                          eggs / allocations
                                                                                     │
                                                                                     ▼
                                                                          Wings  (:8081, SFTP :2022)
                                                                                     │
                                                                                     ▼
                                                                                  Docker
```

### Why this is the only viable shape

| Requirement | Implication |
|---|---|
| Wings needs panel-pushed config | A panel must own the state → use the real panel |
| `troxe-api` holds billing/tickets/announcements that Pterodactyl lacks | Those must stay in `troxe-api` |
| The frontend must not be rewritten | The `/api/v1` contract must not change |
| All three above | → `troxe-api` becomes a BFF, not a Wings client |

---

## 5. Incompatibilities to Bridge

### 5.1 Identity namespace split — the hardest one

| | `troxe-api` | Pterodactyl |
|---|---|---|
| Store | PostgreSQL `users` (uuid PK) | MySQL `users` (int PK) |
| Count | 4 | 1 (admin) |

Pterodactyl's `servers.user_id` must reference a real row in **its** `users` table.
So every Troxe user needs a mirrored panel user.

**Plan:** add `pterodactyl_user_id` to the Troxe `users` table; provision on first use;
keep email/username in sync; treat the panel as authoritative for server ownership and
Troxe as authoritative for billing identity.

**This must land before any server work.** Everything in Phase 2 depends on it.

### 5.2 Node model mismatch

| | Troxe | Pterodactyl |
|---|---|---|
| `id` | `varchar(32)`, `'local'` = unix socket | `int` auto-increment |
| Daemon | Docker over TCP + own TLS (`node-agent`) | Wings over HTTP/WS |
| Auth | `tlsCa`/`tlsCert`/`tlsKey` per node | `daemon_token` per node |
| Address | `dockerHost`/`dockerPort` + `publicHost` | `fqdn` + `scheme` + `daemonListen` |

The single existing node (`local`, unix socket) has no Pterodactyl counterpart and cannot
be represented — Wings has no unix-socket mode. The first node must be a real Wings
process.

### 5.3 Container identity

`backend/src/db/schema.ts:343`:

```ts
containerId: varchar('container_id', { length: 64 }),
```

`container_id` is a first-class column. Wings does not expose Docker container IDs; it
manages instances by server UUID. Reads and writes across ~17 files reference this column.

### 5.4 Ports and allocations

Wings draws ports from the panel's `allocations` table:

```
allocations: id, node_id, ip, ip_alias, port, server_id, notes, subdomain, ...
```

`troxe-api` has its own `ports.service.ts` doing dynamic candidate-port allocation
(`ports-policy.ts`, `package-policy.ts`). The two policies must be reconciled — either
Troxe allocations are written into the panel, or Wings is driven from a panel-side
allocation pool allocated on Troxe's behalf.

### 5.5 Templates → Eggs

`backend/src/modules/servers/templates/catalog.ts` defines the catalogue (Docker images
such as `oven/bun`, `node`, per-template install/build steps, port plans, startup commands)
— approximately **14 templates / 93 fields**.

Wings consumes **Pterodactyl eggs** (`docker` image + `config` JSON + `variables` +
`install` script). `images.ts:97` already carries a Pterodactyl-aware comment
(*"Egg-style startup variable (cf. Pterodactyl `variables[]`)"*), so the project is
aware of the shape. A converter is required, and install scripts must be rewritten in
`docker_setup` form.

### 5.6 Exec / console transport

| | Current | Required |
|---|---|---|
| Transport | socket.io (`exec.gateway.ts`) | raw WebSocket |
| Endpoint | namespace on `troxe-api` | `wss://node:8081/api/servers/{uuid}/websocket` |
| Auth | shared namespace auth | **one-time panel-issued JWT** per connection |

---

## 6. Work Sizing

| Item | Size |
|---|---|
| `docker.*` call sites to replace | **81**, across **17** files |
| `servers` module | **14,638** LOC |
| Templates → eggs | ~14 |
| `exec.gateway.ts` | socket.io → WS rewrite |
| `stats-stream.service.ts` | REST poll → WS subscription |
| Frontend changes | **0** |

Files currently importing `DockerService`:

```
health/health.controller.ts          servers/packages.service.ts
support/support.service.ts           servers/runtime/local-node-runtime.ts
support/support.module.ts            servers/servers.module.ts
servers/files.service.ts             servers/ports.controller.ts
servers/exec.gateway.ts              servers/reconciler.service.ts
servers/servers.service.ts           servers/provisioning/network-hardening.service.ts
servers/backups.service.ts           servers/provisioning/provisioner.service.ts
servers/stats-stream.service.ts      servers/provisioning/docker.service.ts
nodes/node-pool.service.ts
```

---

## 7. Phased Plan

Each phase is gated. **Do not start a phase until the previous gate passes.**

### Phase 0 — Prove Wings works (GATE)

- Install Wings on this host as a real node, API on **`8081`**, SFTP on **`2022`**
  (8080 is occupied by the panel).
- Register the node in the panel (`fqdn`, `scheme`, `daemonListen`).
- Create **one** test server from a seeded egg.
- Verify: `GET /api/system`, power start/stop, file list/write, console WebSocket.

**Why this is the gate:** if Wings cannot be brought up against the panel installed on
2026-10-15, the entire plan fails and nothing else matters. It touches no `troxe-api` code
and no customer server.

### Phase 1 — Identity bridge (GATE)

- Add `pterodactyl_user_id` to Troxe `users` (migration, nullable).
- `PterodactylUserMirror` service: provision-on-first-use + sync.
- **Gate:** a new Troxe user appears in `panel.users`, and email/username changes propagate.

### Phase 2 — BFF vertical slice

- `WingsClient` (node bearer token) and `PterodactylApplicationClient` (service token) in
  `troxe-api`.
- Take **one** test server through the full lifecycle: Troxe provisioning request →
  panel `POST /api/application/servers` → Wings → console.
- **Gate:** one server fully managed through `troxe-api` with the frontend unchanged.

### Phase 3 — Replace the runtime

- Convert templates to eggs.
- Replace the 81 `docker.*` call sites.
- Rewrite `exec.gateway.ts` and `stats-stream.service.ts`.
- Reconcile ports/allocations.
- **Dual-write** against the 3 live servers; no cutover until verified.

### Phase 4 — Cutover

- Migrate the 3 `online` servers deliberately.
- Decommission `node-agent` only after cutover is proven.

---

## 8. Risks and Open Items

### 8.1 Live production data
Three customer servers are running. Phases 2–4 must be **side-by-side with dual-write**.
Any plan that migrates in place is unacceptable.

### 8.2 Dual source of truth
Servers will exist in both `panel.servers` (MySQL) and `troxe.servers` (Postgres).
**The panel must be authoritative.** Troxe mirrors. A reconciliation job is required —
`reconciler.service.ts` is the natural home for it.

### 8.3 Proxy ownership — decided: keep `proxy-agent`
Wings generates a reverse-proxy config per server. The fork's panel **does not emit a
`[proxy]` section** in the Wings config:

```php
// app/Models/Node.php:142 — getConfiguration()
// keys: api, system, allowed_mounts, remote  — no 'proxy'
```

Wings defaults its reverse proxy to **disabled**. Therefore keeping `proxy-agent`
(`proxy-agent/agent.js`, port 8443) alongside the panel's `Subdomains` / `Cloudflare` /
`Proxy` services is compatible and requires **no change**. This decision is free.

### 8.4 Panel `remote` callback
The generated config sets `'remote' => route('index')`, i.e. Wings calls back to the panel
for deauthorize-user and websocket denial. With the panel on an IP and HTTP, this must be
reachable from every node.

### 8.5 Unresolved
- Migration strategy for the 3 live servers (in-place vs. re-provision).
- Whether Wings' `remote` callback and `allowed_mounts` need host-specific tuning on
  multi-node deployments.
- Backups: `backups.service.ts` vs Wings' S3-based backup endpoints (`/api/servers/{uuid}/backup`,
  `/restore`) — the fork has its own `backup-paths.ts` semantics.

---

## 9. Installation Defects Found in `pterodactyl-panel` (remediated locally)

The panel was installed on 2026-10-15. `install.sh` failed six times before completing.
None of these are hypothetical — each blocked the install. **The repository is unchanged;
all fixes are in a local patch.**

| # | Defect | Detail |
|---|---|---|
| 1 | `.env.example` missing from git | `.gitignore` has `!.env.example` but the file was never committed. Installer exits at the preflight check. Recovered from `panel.tar.gz`. |
| 2 | **`yarn.lock` corrupt** | yarn 1.22 aborts with `SyntaxError: Invalid value type`. Verified byte-identical to `HEAD` (`md5 7fdd50bc…`) — a genuine upstream defect. `package-lock.json` is valid and in sync (1294 packages, 125/125 deps), so the build was switched to npm. |
| 3 | `storage/framework/*` missing | `cache`, `sessions`, `views` are absent from the repo. Laravel dies with `Please provide a valid cache path`. The `Dockerfile` does the same `mkdir`; `install.sh` omits it. |
| 4 | `mysqladmin ping` false positive | Returns success even on `Access denied`, so any re-run took the socket-auth branch and failed. Replaced with a real `SELECT 1` probe. |
| 5 | nginx never started | Script installs nginx then calls `systemctl reload` on an inactive unit. Now `enable` + `restart`. |
| 6 | Installer banner lies | Claims admin `admin / Gg1master@`. `DatabaseSeeder` only calls `NestSeeder` + `EggSeeder`; **no admin is created**. Created via `p:user:make`. |

Additional installer issues worked around for this deployment:

- **Port 80 conflict** — `troxe-caddy` holds 80/443 with host networking. Panel moved to
  `8080`; stock `default` vhost must be removed or nginx fails to start.
- **`PANEL_BASE_DOMAIN` hardcoded to `hosting.troxe.dev`** — the author's domain, not the
  operator's. Overridden.
- **`session.cookie_secure = 1`** — makes login impossible over plain HTTP. Made
  conditional on TLS.
- **No admin seeder** — see #6.

Local patch: `install.sh.patch` (174 lines, against the pristine `install.sh`).

### 9.1 Repository hygiene (not remediated)

| Item | Size | Note |
|---|---|---|
| `graphify-out/graph.json` | 8.3 MB | dev artifact |
| `panel.tar.gz` | 3.0 MB | contains the only copy of `.env.example` and prebuilt assets |
| `eggs/`, `graphify-out/` | — | tooling output committed to the repo |

`.env.example` should be committed. The `yarn.lock` should be regenerated. As it stands,
the repository cannot be installed from a clean clone without the steps in this document.

---

## 10. Recommendation

Proceed with **Phase 0 only**, for now.

Phase 0 is the genuine gate: it costs roughly an hour, modifies nothing in `troxe-api`,
touches no customer server, and it is the only way to find out whether the plan is
feasible before committing to Phases 1–4.

Separately, and independent of Wings: `new-troxe-hosting` already contains a complete,
well-executed panel frontend (32.7k LOC, 47 routes, 17-component UI kit, monochrome
Tailwind v4 design system). If the near-term goal is *"make the panel look like Troxe"*,
that is a **design-system port to the Pterodactyl frontend** and does not require the
Wings migration at all — see §2.4.