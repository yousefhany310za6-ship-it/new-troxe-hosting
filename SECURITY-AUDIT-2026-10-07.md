# Full Project Security, Reliability, Performance & Maintainability Audit

- **Date:** 2026-10-07
- **Scope:** entire project (backend NestJS + frontend React + Docker + Postgres)
- **Method:** 10 independent specialized researchers (auth, authorization, API/rate-limit, injection, Docker/infra, database/concurrency, filesystem/backup, frontend, performance, architecture) → correlation → attack-chain analysis → independent re-verification by the lead. Findings below are CONFIRMED only when proven from code or live test; everything else is labeled hypothesis or rejected.
- **Rule followed:** no fixes were applied during discovery (working tree untouched by the audit).

## Executive Summary

**No confirmed Critical vulnerabilities were identified.** No authentication bypass, no RCE, no container escape, no IDOR — all refuted with evidence. Confirmed totals: **High: 2, Medium: 10, Low: 12**, plus hardening/informational items. Most dangerous confirmed items: marketing campaigns email suspended/deleted users, and no synchronous storage quota on file writes. Strongest controls observed: no OAuth auto-merge, signed state/PKCE, row-locked refresh rotation with theft detection, digest-pinned container images with full capability drops, dual ownership checks.

## Confirmed Vulnerabilities

### High (2)

**[High] H1 — Marketing campaigns target suspended AND deleted users.**
Recipient filter checks only `notifyMarketing` (`backend/src/modules/admin/email-campaign.service.ts:180`); `deliverOne` re-checks only marketing opt-in (`:371`). No `users.status === 'active'` predicate at snapshot or send time. Any campaign reaches closed accounts. Fix: add the predicate + mark their pending rows `skipped`. Regression test: seed active+suspended+deleted with `notifyMarketing=true`, run send+tick, assert only active gets `sent`.

**[High] H2 — No synchronous storage quota on file writes.**
No `volumeUsage` anywhere in `files.service.ts`; enforcement is only the hourly reconciler sample (5 servers/tick, fail-open). 1 GiB uploads pass individually while aggregate usage grows unbounded. Fix: pre-write quota check against `storageGb`. Regression test: 3× 300 MB uploads on a 1 GB plan, assert 2nd/3rd rejected.

### Medium (10)

- **M1 — Refresh 60s grace mints valid sessions from superseded secrets** (`auth.service.ts:289-337`). A stolen previous secret presented within grace is treated as benign retry (fresh valid token, no family wipe). Fix: narrow grace / bind to retry idempotency.
- **M2 — OAuth-only `password-set` never revokes sessions** (`users.service.ts`, vs `updatePassword` which revokes). Stolen session → permanent credential. Fix: `revokeAllForUser` + version bump.
- **M3 — Reconciler storage fence lifts suspension** (`reconciler.service.ts:327-354` has no `suspended` skip, unlike `syncStatuses:143`). Over-quota suspended server flips to `error` and becomes usable again with no unsuspend audit. Fix: skip suspended rows.
- **M4 — Suspend-then-start race** (`servers.service.ts`: `assertOperable` runs before `acquire(id)`). A `start` that passed the check can proceed after a concurrent `suspend`. Fix: re-check after acquiring the lock.
- **M5 — Impersonation is live, indistinguishable, and mis-audited.** Route `POST users/:id/impersonate` exists (`admin.controller.ts:359`) despite a "NOT exposed" comment; token is a normal access JWT (`admin.service.ts:516`), `JwtAuthGuard` never reads `imp`, actions audit as the victim, issuance hardcodes `actorEmail:'admin'`. Fix: scope the token, surface `imp`, add banner/forced-expiry UX.
- **M6 — Admin `POST servers/:id/backups` shadowed by `:action` route** (registration order). **Reproduced live: 400 ACTION_UNSUPPORTED**, no side effect. Admin backup-create is unreachable. Fix: register static routes before the parametric route.
- **M7 — No validation on WS gateway payloads** (no ValidationPipe on either gateway; e.g. `resize(NaN)`). Mitigated by manual checks; fix with DTOs + pipe.
- **M8 — Plan downgrade leaves stale limits** (server rows keep old `cpuMilli/ramMb/storageGb`; no prune of excess). Fix: effective-cap = min(snapshot, live plan).
- **M9 — Soft-deleted users keep getting auto-backups** (`createAutoIfDue` never joins `users.status`). PII retention + waste. Fix: filter to active owners.
- **M10 — Tarbomb: `ARCHIVE_MAX` checks compressed size only** (`files.service.ts:368-369`); extracted output unbounded. Fix: post-extract `du` gate.

### Low (12)

L1 linkToken cleartext-in-URL + replayable (10 min); L2 suspended-login oracle (403 vs 401); L3 live WS survives credential revocation (read-only); L4 live WS survives server suspension (read-only); L5 zip symlink members persist (no purge as in restore); L6 avatar crop without DTO class; L7 username-cooldown bypass race; L8 concurrent reset double-mint; L9 permanent `EXEC_BUSY` via `closeUserSessions` else-branch (deletes `bySocket` only); L10 unbounded admin `page` offsets (+ leading-wildcard search, admin-only); L11 crash-midway `deleting`→`error` with orphaned row; L12 partial iptables install reports success (`applied > 0`).

### Informational / hardening

Dead `auth_sessions.revokedAt` column (written nowhere); password-reset honored for inactive accounts (blocked downstream — defense-in-depth note); `.env.prod` without `chmod 600`; `HARDEN_NETWORK=false` fails open; secrets `export`ed in deploy shell; log newline injection (no sanitizer at log boundary); no CSP on SPA; PDF preview iframe without `sandbox`; unquoted `basename` in restore tar command (storageKey is UUID-generated — hardening only); `du` size-gate quotes the literal `$r` (pre-check vacuous); single-instance assumptions throughout (locks/streams/throttler — no second replica before Redis/sticky WS); N+1 spots (`lastKnownCountry` per row, serial `volumeUsage` in `getUser`); campaign `ids[5000]` fan-out; unbounded `subscribe.channels[]`; 1 h upload lock hold (design tradeoff); ticket TTL doc mismatch (300s vs "30s"); `geoip-lite` CVEs (ip-address/sprintf-js — **not reachable**: no HTML emission, no allowlisting, inputs ≤45 chars); `solid-js→seroval` criticals via `@tanstack/query-devtools` (**not in prod bundle** — lazy + DEV-only, verified absent from built assets; recommend moving to devDependencies); IPv6 (no ip6tables rules — check host egress first).

## Potential findings (hypotheses, NOT confirmed)

OAuth placeholder squat; verify-attempts counter race; login-CSRF planting; cross-browser link completion; hostile restore archive (needs helper-image check); tar verbose-parse variance; helper-script TOCTOU (impractical); torn backup archives; log-marker collision; multi-instance races; demotion 15-min window; sharp CPU saturation (needs measurement); `decodeDockerLogs` fuzz; suspended user with running `error` container.

## False positives register (rejected with preventing control)

OAuth auto-merge; open redirect (dual sanitize); PKCE/state; code brute force; session fixation; bcrypt truncation; family-wipe resurrection; logout-all remnants; logout CSRF theft; prod cookies; mass assignment (global whitelist+forbid); `q()` shell quoting; traversal/symlink dual layers; SSRF (no server-side URL fetch); XSS sinks (zero); prototype pollution; ReDoS (inventory clean); verify-then-parse order; `requireOwned('admin')` reachability; cross-user backups/files; UUID oracle; role-claim escalation; self-actions; grant binding; suspended WS direct access; plan escalation; user route shadowing; toast/redirect/avatar sinks; signup enumeration (accepted, throttled); impersonation auth (guarded — finding is scope/storage); deleting transient; numeric `sql.raw`; download route drift; status-map cosmetics; numeric overflow (capped scales); transaction coverage (create/quota/refresh/OAuth/signup); upload memory streaming; log bombs capped; WS flood budgets; bcrypt async; stats-stream cleanup; `withDeadline` clearing; bundle splitting; impersonation comment vs guarded route.

## Attack chains

- **A (highest impact, low skill):** IP-only throttle + 30×1 GB uploads + no quota + hourly fence = disk exhaustion DoS.
- **B:** suspension + later over-quota + storage fence = passive suspension defeat.
- **C (persistence):** stolen refresh → 60s grace legitimizes it; stolen OAuth session → password-set without revoke; admin → impersonate without attribution.
- **D (recon):** signup-taken + suspended-login + OAUTH_LINK_REQUIRED = account map for phishing.
- **E (blast radius):** stolen admin session = impersonate anyone + read files + suspend/delete — not a vuln per se, justifies prioritizing M5.

## API security audit (condensed inventory)

~96 endpoints, all JWT-guarded except: public plans list, avatar file-by-random-key, unsubscribe (HMAC token), Resend webhook (Svix raw-byte verify), health liveness (static) / readiness (throttled+cached). Ownership: `ServerOwnerGuard` + `requireOwned` re-check on all 30 server routes; admin via resolved real owner + explicit `{admin:true}` bypasses. Validation: global whitelist+forbid pipe; `CreateServerDto` has no `planId`; file paths 512 chars + server-side re-checks; upload requires numeric Content-Length + 1 GiB cap. WS: ticket handshake, per-channel ownership at subscribe, exec 1/server + 3/user, 4 KB input, flood/output budgets, 2 h idle / 12 h max.

## Rate limit audit (condensed matrix)

Default 300/min **IP-only** (no custom tracker — verified absent). Auth 8/min + per-account lockout (survives distribution). Lifecycle 10 (reinstall 5, restore 3). Files 30/10. Reads 60. Admin 30 (coarse for incidents), password 10, impersonate 5. Email-auth 3–10/10 min. OAuth 30. Avatar 10/20/300-serve. Webhook 60. Gaps: multi-IP multiplication, shared-NAT buckets, `TRUST_PROXY=false` default (proxy = one shared bucket), unbounded `page`, unbounded `subscribe.channels[]`, no per-account upload brake, campaign send shares the 60/min email-admin bucket.

## Authentication audit

Sound core (short JWT + opaque rotation + lockout + sha256-prehash). Findings: M1, M2, L-oracle, L-linkToken, L-WS-after-revoke, TTL doc mismatch. Rejected: merge, fixation, brute force, truncation, wipe logic.

## Authorization audit

No IDOR/BOLA/escalation confirmed. Guards mirror UI gating. Exceptions: M5, M6 (live-proven), P1 fail-closed inconsistency, P2 owner reads allowed by design.

## Container / infrastructure audit

Isolation verified strong (digest allowlist, no host ports/bindssock, CapDrop-all, non-root, per-server nets, fixed helper configs, secret-free env). Remaining: L12, IPv6-check, chmod, CSP/edge-limits, deploy notes; single-instance only.

## File / backup audit

Confirmed: H2 (via quota absence), M10, L-zip-symlink + 8 controlled surfaces (traversal dual-layer, quoting, atomic rename, 411/truncation, attachment downloads, avatar re-encode). Hypotheses P1–P5 (restore-tar needs image proof).

## Database / concurrency audit

Confirmed H2, M3, M4, M8, M9 + small races (username, reset, deleting). Safe: count/slot/refresh/signup/OAuth/token bumps/lockout (locks + txns + unique indexes). Single-instance caveat documented. Migration 0014 replay-safe under drizzle's per-statement execution; no DOWN migration (enum removal needs catalog surgery).

## Frontend security audit

No XSS (zero dangerous sinks; console renders text nodes; no HTML preview), no open redirect (dual sanitize), memory-only tokens, no cookie-only mutations, allowlist CORS, clickjacking covered at edge, OAuth callback safe, no client-only trust, no suspend polling loops. One confirmed: M5 storage half. Hardening: CSP, PDF sandbox.

## Performance / load audit (code-based — NO live load was run against production)

Ranked costs: backup create/restore, provision storms (no semaphore), 1 GB uploads (lock hold), base64 write argv, downloads via log capture, archive/extract, logs tail, one-shot stats (~1 s block), per-call `ensureImage`, admin `getUser` serial volumeUsage, bcrypt pool, avatar sharp, campaign serial delivery, OAuth/GeoIP. DoS vectors V1–V11 documented above (highest: uploads, backups, provisions, offsets, bcrypt, polling, reconciler, EXEC_BUSY leak, IP-keying, disk, email burn). N+1 list and timer/container/lock lifecycle verified; crash-orphaned `sleep infinity` helpers have no reaper. **No p50/p99/RPS figures are reported because none were measured** — that requires a staging environment.

## Code quality / maintainability

Strong: fail-closed env config, centralized exception filter (no stack leaks). Adequate: module acyclicity, error/request correlation, type discipline. Weak: 5+ ownership decision sites (+ `'admin'` magic string), suspension gaps (fixed at core, see M3/M9), WS without validation, dead `revokedAt`, zero security-path tests, duplicated frontend label/status maps, in-memory-everything (no second replica).

## Dependency audit

- Backend (`npm audit --omit=dev`): 3 findings, all via `geoip-lite` (ip-address high, sprintf-js) — **not reachable** in this app (see Informational). Fix requires breaking downgrade; recommend replacing the package long-term.
- Frontend: 2 criticals via `solid-js→seroval` from `@tanstack/query-devtools` — **not shipped** (DEV-only lazy import; absent from production bundle — verified). Recommend moving it to devDependencies.
- Rule applied: scanner output ≠ application vulnerability without a reachable sink.

## Recommended fix priority

- **Immediate:** H1 status filter, H2 synchronous quota gate, M6 route order (one-line).
- **Short-term:** M1 grace tightening, M2 revoke on password-set, M3 reconciler skip, M4 post-lock re-check, M10 extract output gate, M5 impersonation scoping + banner + true audit.
- **Medium-term:** M7 WS validation, M8 live-plan caps, M9 deleted-owner backup filter, all Lows, hardening batch (chmod, CSP, IPv6 verdict, sandbox attr, dead column, log sanitizer).
- **Long-term:** kernel/filesystem quotas, Redis-backed locks/throttle before any second replica, security-path regression suite, ownership-check unification, frontend map unification.

## Verification statement

Independently re-verified by the lead: reconciler gap (code), route shadowing (**live: 400, no side effect**), impersonation mint + guard blindness (code), refresh grace (code), password-set non-revocation (code), quota absence (code), lifecycle ordering (code), auto-backup filter gap (code), tarbomb gate (code), zip-symlink gap (code), campaign targeting (code), StatsStream gap (code), EXEC_BUSY leak (code), partial iptables (code), unquoted basename + vacuous `du` gate (code), WS pipes/avatar-crop/pagination gaps (code), IP-only throttle (code absence), deploy chmod gap (code absence), unreachable dependencies (lockfile + bundle grep). Baseline health: backend typecheck clean, 50/50 unit tests pass, tree clean (no audit-time modifications).
