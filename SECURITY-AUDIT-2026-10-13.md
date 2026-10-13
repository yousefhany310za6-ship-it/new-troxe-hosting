# تقرير التدقيق المستقل — Troxe Hosting
**التاريخ:** 2026-10-13 | **المستودع:** new-troxe-hosting | **الوضع:** Read-only (لم تُطبق أي تعديلات أثناء التدقيق)

## Executive Summary
- لا توجد أي ثغرة Critical مؤكدة (لا RCE، لا تجاوز مصادقة، لا container escape).
- مشكلتان High مثبتتان: F-H1 (marketing لمستخدمين suspended/deleted)، F-H2 (absence synchronous storage quota).
- fixing setup: immediate fix cycles {H1, H2, M6, M3}.
- Production: Conditional Yes for bounded beta; No for public multi-tenant until tests/gaps.

## Coverage
- Backend, Docker, nginx/compose, DB, files/storage, renewal/auth.
- No live tests or Docker/DB performed due read-only constraints.
- Dependency audit could not run in this environment (no npm).

## Architecture
- Monolith NestJS with multitenant server lifecycle.
- Docker host-network + Caddy (host network).
- Important trust: Caddy ↔ API loopback only; backend has NET_ADMIN + docker socket.

## Findings Summary
### High (Confirmed)
1. **F-H1** Email Campaign includes non-active users (user statuses suspended/deleted) at snapshot & send. File refs: backend/src/modules/admin/email-campaign.service.ts.
2. **F-H2** No synchronous quota gating in file uploads; hourly reconciler fallback only. File ref: backend/src/modules/servers/files.service.ts.

### Medium (High Confidence)
1. M1 Refresh token grace (60s) potentially validates superseded tokens.
2. M2 OAuth password-set may not revoke preexisting sessions.
3. M3 Reconciler may lift suspended status during storage fence.
4. M4 Suspend-then-start race (TOCTOU).
5. M5 Impersonation token scoping/audit weakness.
6. M6 Admin route shadowing (POST backups vs :action) causing 400.
7. M10 (tar) — extraction size gate absent (compressed-only).
8. M9 (auto backup) soft-deleted users still backed up.

### Low
- WS ticket risks, admin pagination wildcards, bookmark/symlink handling details, CSP absence, etc.

## Go / No-Go
- Block launch P0: H1, H2, M6, M3.
- P1: session revocation fixes, route-level validation.
- P2: CSP, hard disk quota, retention.

## Evidence
- All prior operations cross validated via source only.
- Working tree remained unchanged until report creation.
