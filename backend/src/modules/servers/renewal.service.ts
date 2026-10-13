import { createHash } from 'crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { DB, Db } from '../../db/db.module';
import { AppError, Err, pgCodeOf } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { config } from '../../config/env';
import { plans, serverRenewalSessions, serverRenewals, servers, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { RealtimeGateway } from '../auth/realtime.gateway';
import { ServersService } from './servers.service';
import {
  COMPLETION_ATTEMPTS_PER_SESSION,
  RENEWAL_HOURS,
  SESSION_START_PER_HOUR,
  SESSION_TTL_MINUTES,
  TERMINAL_SESSION_STATES,
  PROVIDER_TOKEN_TTL_MINUTES,
  checkEligibility,
  evaluateVerdict,
  expiryState,
  minutesRemaining,
  nextExpiry,
  validateTokenShape,
  type FailureReason,
} from './renewal-policy';
import { WorkinkService } from './workink.service';
import { buildReturnUrl } from './workink-client';

const MAX_HISTORY = 20;

/** What the browser is told. Never includes a key, a token hash or an IP. */
export interface RenewalView {
  id: string;
  serverId: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  failureReason: string | null;
}

function sessionView(row: typeof serverRenewalSessions.$inferSelect): RenewalView {
  return {
    id: row.id,
    serverId: row.serverId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    failureReason: row.failureReason ?? null,
  };
}

/** sha256 of the key — the replay guard's key. The key itself is never stored. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Free-plan renewal.
 *
 * Shape of the guarantee this service provides:
 *  - a server's runtime is extended ONLY after Work.ink has confirmed, for
 *    this attempt, that a key minted by OUR link was redeemed;
 *  - one key backs at most one attempt, enforced by a unique index (not by
 *    application logic), so concurrent double-submits cannot both win;
 *  - the extension itself happens once, inside one transaction that also
 *    records the grant — a failed Docker restart afterwards cannot cost the
 *    user the 24 hours they earned;
 *  - every decision reads the clock from the database/host, never the client.
 */
@Injectable()
export class RenewalService {
  private readonly log = new Logger(RenewalService.name);

  constructor(
    @Inject(DB) private db: Db,
    private servers: ServersService,
    private workink: WorkinkService,
    private audit: AuditService,
    private realtime: RealtimeGateway,
  ) {}

  // ---------------------------------------------------------------------
  // reads
  // ---------------------------------------------------------------------

  /** Expiry + renewal state for one server, as seen by its owner. */
  async statusFor(ownerId: string, serverId: string) {
    const row = await this.servers.requireOwned(ownerId, serverId);
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, row.planId ?? '')).limit(1);
    const now = new Date();
    const state = expiryState({ expiresAt: row.expiresAt, now });
    const eligibility = checkEligibility({
      lifetimeHours: plan?.serverLifetimeHours ?? null,
      expiresAt: row.expiresAt,
      status: row.status,
      now,
    });
    const open = await this.openSession(ownerId, row.id, now);
    return {
      server: {
        id: row.id,
        name: row.name,
        status: row.status,
        suspendedReason: row.suspendedReason ?? null,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        minutesRemaining: minutesRemaining(row.expiresAt, now),
      },
      expiryState: state,
      plan: { id: plan?.id ?? null, name: plan?.name ?? null, lifetimeHours: plan?.serverLifetimeHours ?? null },
      eligible: eligibility.eligible,
      ineligibleReason: eligibility.reason ?? null,
      message: eligibility.message ?? null,
      renewalHours: RENEWAL_HOURS,
      // how long the provider's own key stays valid — the UI warns with this
      // so a slow user is told WHY before they paste a dead key
      providerKeyTtlMinutes: PROVIDER_TOKEN_TTL_MINUTES,
      provider: { name: 'Work.ink', available: this.workink.ready().ready },
      session: open ? sessionView(open) : null,
    };
  }

  /** A session, but only if it belongs to the caller. */
  async requireOwnSession(userId: string, sessionId: string) {
    const [row] = await this.db
      .select()
      .from(serverRenewalSessions)
      .where(and(eq(serverRenewalSessions.id, sessionId), eq(serverRenewalSessions.userId, userId)))
      .limit(1);
    if (!row) throw Err.notFound('RENEWAL_SESSION_NOT_FOUND');
    return row;
  }

  async history(ownerId: string, serverId: string) {
    await this.servers.requireOwned(ownerId, serverId);
    const rows = await this.db
      .select()
      .from(serverRenewals)
      .where(eq(serverRenewals.serverId, serverId))
      .orderBy(desc(serverRenewals.createdAt))
      .limit(MAX_HISTORY);
    return rows.map((r) => ({
      id: r.id,
      hours: r.hours,
      expiresBefore: r.expiresBefore.toISOString(),
      expiresAfter: r.expiresAfter.toISOString(),
      restarted: r.restarted,
      restartError: r.restartError ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------
  // step 1 — open an attempt
  // ---------------------------------------------------------------------

  /**
   * Create a renewal attempt for a server the caller owns.
   *
   * Ownership, plan and expiry are all re-read here; the browser's opinion of
   * any of them is irrelevant. The session TTL is short and fixed server-side.
   */
  async open(ownerId: string, serverId: string, ctx: ReqCtx) {
    const readiness = this.workink.ready();
    if (!readiness.ready) {
      // Never half-configured: refuse loudly instead of creating a session the
      // user can never finish.
      throw new AppError(
        'RENEWAL_UNAVAILABLE',
        503,
        `Server renewal is not available right now (missing: ${readiness.missing.join(', ')}).`,
      );
    }

    const server = await this.servers.requireOwned(ownerId, serverId);
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, server.planId ?? '')).limit(1);
    const now = new Date();

    const eligibility = checkEligibility({
      lifetimeHours: plan?.serverLifetimeHours ?? null,
      expiresAt: server.expiresAt,
      status: server.status,
      now,
    });
    if (!eligibility.eligible) {
      throw Err.invalid(eligibility.reason!, eligibility.message);
    }

    // rate limit: attempts started per account, counted in the database so it
    // survives a restart and applies across processes.
    const recent = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(serverRenewalSessions)
      .where(
        and(
          eq(serverRenewalSessions.userId, ownerId),
          sql`${serverRenewalSessions.createdAt} > now() - interval '1 hour'`,
        ),
      );
    if ((recent[0]?.n ?? 0) >= SESSION_START_PER_HOUR) {
      throw Err.tooMany('RENEWAL_RATE_LIMITED');
    }

    // Reuse a still-open attempt instead of minting a new one: the user should
    // not accumulate dead sessions by clicking twice.
    const existing = await this.openSession(ownerId, serverId, now);
    if (existing) return this.withRedirect(existing);

    const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000);
    const [created] = await this.db
      .insert(serverRenewalSessions)
      .values({
        userId: ownerId,
        serverId,
        status: 'pending',
        expiresAt,
        ip: ctx.ip,
        userAgent: ctx.device,
      })
      .returning();

    await this.audit.record({
      actorId: ownerId,
      action: 'server.renewal.session.open',
      targetType: 'server',
      targetId: serverId,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: { sessionId: created.id },
    });

    return this.withRedirect(created);
  }

  /** Attach the Work.ink redirect URL. A missing override degrades, never breaks. */
  private async withRedirect(row: typeof serverRenewalSessions.$inferSelect) {
    const cfg = this.workink.cfg();
    const returnUrl = buildReturnUrl(cfg, row.id);
    return {
      session: sessionView(row),
      // The browser is handed a work.ink URL and nothing else — it cannot
      // choose a destination, and we never expose the provider's secrets.
      redirectUrl: await this.workink.redirectFor(returnUrl),
    };
  }

  // ---------------------------------------------------------------------
  // step 2 — complete with a proof
  // ---------------------------------------------------------------------

  /**
   * Verify a Work.ink key and, only on success, grant the extra runtime.
   *
   * Order matters: the attempt is CLAIMED (`pending → verifying`) with a
   * conditional UPDATE before any network call, so two simultaneous
   * submissions of the same key cannot both reach Work.ink.
   */
  async complete(userId: string, sessionId: string, rawToken: unknown, ctx: ReqCtx) {
    const session = await this.requireOwnSession(userId, sessionId);
    const now = new Date();

    // Shape-check locally: a malformed key never costs a network call, and it
    // does NOT close the attempt — the user most likely pasted the wrong thing
    // and still has a perfectly good key waiting.
    const shaped = validateTokenShape(rawToken);
    if (!shaped.ok) {
      throw new AppError('RENEWAL_VERIFICATION_FAILED', 400, messageFor(shaped.reason));
    }

    if ((TERMINAL_SESSION_STATES as readonly string[]).includes(session.status)) {
      // Idempotent-by-refusal: a completed session returns the SAME answer it
      // gave before, it does not grant again and it does not error out into a
      // second extension.
      throw Err.conflict('RENEWAL_SESSION_CLOSED', 'This renewal attempt was already finished.');
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.markExpired(session, ctx);
      throw Err.invalid('RENEWAL_SESSION_EXPIRED', 'This renewal attempt expired. Start a new one.');
    }

    // Claim the attempt. `status = 'pending'` in the WHERE is the concurrency
    // fence: a concurrent duplicate updates 0 rows and is rejected below.
    // `attempts` is bumped on every claim so a client cannot grind the
    // provider with an unbounded number of wrong keys on one session.
    const claimed = await this.db
      .update(serverRenewalSessions)
      .set({ status: 'verifying', attempts: sql`${serverRenewalSessions.attempts} + 1`, updatedAt: now })
      .where(and(eq(serverRenewalSessions.id, session.id), eq(serverRenewalSessions.status, 'pending')))
      .returning();
    if (!claimed.length) {
      throw Err.conflict('RENEWAL_IN_PROGRESS', 'This renewal attempt is already being verified.');
    }
    const attempts = claimed[0].attempts;
    if (attempts > COMPLETION_ATTEMPTS_PER_SESSION) {
      await this.failSession(session, 'RATE_LIMITED', ctx);
    }

    const cfg = this.workink.cfg();
    // consume: the provider deletes the key after checking it. If that call
    // fails we do NOT fail the renewal — our own unique index already prevents
    // reuse, so the provider delete is a second layer, not the guarantee.
    const verdict = await this.workink.validateToken(shaped.token, { consume: true });
    const evaluated = evaluateVerdict({ verdict, expectedLinkId: cfg.linkId, now });

    if (!evaluated.ok) {
      // A rejected KEY is not a rejected ATTEMPT. The user may simply have
      // pasted the wrong string, or the key may have expired in transit — and
      // forcing them back through the whole Work.ink round trip for that is
      // punishing behaviour with no security benefit: nothing was granted, and
      // `token_hash` is still NULL, so their unused key remains redeemable here
      // and still cannot back a second server (unique index).
      //
      // So the attempt is returned to `pending` — bounded by
      // COMPLETION_ATTEMPTS_PER_SESSION, which is enforced on the claim below.
      if (evaluated.retryable || session.attempts < COMPLETION_ATTEMPTS_PER_SESSION) {
        await this.db
          .update(serverRenewalSessions)
          .set({ status: 'pending', failureReason: evaluated.reason, updatedAt: new Date() })
          .where(eq(serverRenewalSessions.id, session.id));
        await this.audit.record({
          actorId: userId,
          action: evaluated.retryable ? 'server.renewal.verify.unavailable' : 'server.renewal.verify.reject',
          targetType: 'server',
          targetId: session.serverId,
          ip: ctx.ip,
          userAgent: ctx.device,
          meta: { sessionId: session.id, reason: evaluated.reason, attempt: session.attempts },
        });
        if (evaluated.retryable) {
          throw new AppError(
            'RENEWAL_PROVIDER_UNAVAILABLE',
            503,
            'We could not reach the verification service. Your server was NOT extended — please try again.',
          );
        }
        throw new AppError('RENEWAL_VERIFICATION_FAILED', 400, messageFor(evaluated.reason));
      }
      // attempts exhausted — close it so the endpoint cannot be used to grind
      return this.failSession(session, evaluated.reason, ctx);
    }

    // ---- the grant: one transaction, exactly once -------------------------
    const tokenHash = hashToken(shaped.token);
    let grant!: { expiresAfter: Date; previousExpiresAt: Date | null };
    try {
      grant = await this.db.transaction(async (tx) => {
        const [server] = await tx
          .select()
          .from(servers)
          .where(eq(servers.id, session.serverId))
          .for('update')
          .limit(1);
        if (!server) throw Err.notFound('SERVER_NOT_FOUND');

        // Re-check eligibility at grant time: the plan may have changed, or the
        // deadline moved, while the user was away at Work.ink.
        const [plan] = await tx.select().from(plans).where(eq(plans.id, server.planId ?? '')).limit(1);
        const at = new Date();
        const eligibility = checkEligibility({
          lifetimeHours: plan?.serverLifetimeHours ?? null,
          expiresAt: server.expiresAt,
          status: server.status,
          now: at,
        });
        if (!eligibility.eligible) throw Err.invalid(eligibility.reason!, eligibility.message);

        // newExpiresAt = serverTime + 24h, per the product rule
        const expiresAfter = nextExpiry(at, RENEWAL_HOURS);

        // Inserting the grant row FIRST, under the row lock, means the unique
        // index on session_id is the thing that makes a double grant
        // impossible — not an application-level "did I already?" check.
        await tx.insert(serverRenewals).values({
          serverId: server.id,
          userId,
          sessionId: session.id,
          hours: RENEWAL_HOURS,
          expiresBefore: server.expiresAt ?? expiresAfter,
          expiresAfter,
        });

        await tx
          .update(servers)
          .set({
            expiresAt: expiresAfter,
            // still suspended (expiry) — the restart below brings it back.
            // Clearing suspendedReason would hide "it expired" from the UI.
            updatedAt: at,
          })
          .where(eq(servers.id, server.id));

        await tx
          .update(serverRenewalSessions)
          .set({
            status: 'completed',
            verifiedAt: at,
            tokenHash,
            tokenLinkId: evaluated.linkId,
            tokenCreatedAt: evaluated.createdAt,
            tokenIp: evaluated.ip,
            failureReason: null,
            updatedAt: at,
          })
          .where(eq(serverRenewalSessions.id, session.id));

        return { expiresAfter, previousExpiresAt: server.expiresAt };
      });
    } catch (e) {
      // The unique index fired: this key/session already produced a grant.
      if (pgCodeOf(e) === '23505') {
        throw Err.conflict('RENEWAL_ALREADY_APPLIED', 'This renewal has already been applied.');
      }
      throw e;
    }

    // ---- bring the server back ------------------------------------------
    // Deliberately AFTER the committed grant: a Docker failure here must not
    // roll back the 24 hours the user earned. The row records whether the
    // restart worked so support (and the owner) can see it.
    const restart = await this.tryRestart(session.serverId);
    await this.db
      .update(serverRenewals)
      .set({ restarted: restart.ok, restartError: restart.error ?? null })
      .where(eq(serverRenewals.sessionId, session.id));

    await this.audit.record({
      actorId: userId,
      action: 'server.renewal.grant',
      targetType: 'server',
      targetId: session.serverId,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: {
        sessionId: session.id,
        hours: RENEWAL_HOURS,
        linkId: evaluated.linkId,
        expiresAfter: grant.expiresAfter.toISOString(),
        restarted: restart.ok,
      },
    });

    const [final] = await this.db
      .select()
      .from(serverRenewalSessions)
      .where(eq(serverRenewalSessions.id, session.id))
      .limit(1);

    return {
      session: final ? sessionView(final) : null,
      expiresAt: grant.expiresAfter.toISOString(),
      restarted: restart.ok,
      // success is only reported once the backend committed it
      restartError: restart.ok ? null : (restart.error ?? 'The server will be started on its next renewal.'),
    };
  }

  /** Restart after a renewal, tolerating failure without losing the grant. */
  private async tryRestart(serverId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const [row] = await this.db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
      if (!row) return { ok: false, error: 'Server not found' };
      // only an expiry suspension is ours to lift; an admin suspension stays
      if (row.status === 'suspended' && row.suspendedReason !== 'expired') {
        return { ok: false, error: 'This server is suspended by the administration.' };
      }
      await this.servers.restoreFromExpiry(serverId);
      return { ok: true };
    } catch (e) {
      this.log.warn(`renewal restart failed for ${serverId}: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  }

  /** Terminal failure. The attempt is closed — a key cannot be retried on it. */
  private async failSession(
    session: typeof serverRenewalSessions.$inferSelect,
    reason: FailureReason,
    ctx: ReqCtx,
  ): Promise<never> {
    await this.db
      .update(serverRenewalSessions)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(eq(serverRenewalSessions.id, session.id));
    await this.audit.record({
      actorId: session.userId,
      action: 'server.renewal.verify.fail',
      targetType: 'server',
      targetId: session.serverId,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: { sessionId: session.id, reason },
    });
    // never echo the key back, never log it
    throw new AppError('RENEWAL_VERIFICATION_FAILED', 400, messageFor(reason));
  }

  private async markExpired(session: typeof serverRenewalSessions.$inferSelect, ctx: ReqCtx) {
    await this.db
      .update(serverRenewalSessions)
      .set({ status: 'expired', failureReason: 'SESSION_EXPIRED', updatedAt: new Date() })
      .where(and(eq(serverRenewalSessions.id, session.id), eq(serverRenewalSessions.status, 'pending')));
    void ctx;
  }

  private async openSession(userId: string, serverId: string, now: Date) {
    const [row] = await this.db
      .select()
      .from(serverRenewalSessions)
      .where(
        and(
          eq(serverRenewalSessions.userId, userId),
          eq(serverRenewalSessions.serverId, serverId),
          eq(serverRenewalSessions.status, 'pending'),
          sql`${serverRenewalSessions.expiresAt} > now()`,
        ),
      )
      .orderBy(desc(serverRenewalSessions.createdAt))
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------------
  // expiry sweep
  // ---------------------------------------------------------------------

  /**
   * Suspend every server whose deadline has passed.
   *
   * Safe to run repeatedly and to run twice concurrently: each row is claimed
   * with a conditional UPDATE (`status <> suspended`) so only one worker can
   * take it. A Docker failure still records the suspension in the database, so
   * the backend gate keeps the server unusable even if the container is still
   * running — the opposite order would leave a live-but-blocked server.
   */
  async sweepExpired(limit = 50): Promise<{ suspended: number; failed: number }> {
    const now = new Date();
    const due = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(
        and(
          sql`${servers.expiresAt} is not null`,
          lt(servers.expiresAt, now),
          inArray(servers.status, ['online', 'offline', 'error', 'restarting', 'provisioning']),
        ),
      )
      .limit(limit);

    let suspended = 0;
    let failed = 0;
    for (const { id } of due) {
      const claimed = await this.db
        .update(servers)
        .set({ status: 'suspended', suspendedReason: 'expired', updatedAt: now })
        .where(and(eq(servers.id, id), sql`${servers.status} <> 'suspended'`))
        .returning({ id: servers.id });
      if (!claimed.length) continue; // someone else got it
      suspended++;
      try {
        await this.servers.stopForExpiry(id);
      } catch (e) {
        failed++;
        this.log.warn(`expiry stop failed for ${id}: ${(e as Error).message}`);
      }
      this.realtime.broadcastServerStatus(id, 'suspended');
    }
    return { suspended, failed };
  }
}

/** Human-readable copy for each failure reason. Never mentions the key. */
function messageFor(reason: FailureReason): string {
  switch (reason) {
    case 'TOKEN_MISSING':
      return 'No verification key was provided.';
    case 'TOKEN_MALFORMED':
      return 'That verification key is not in a valid format.';
    case 'TOKEN_INVALID':
      return 'That verification key was not accepted. Start a new renewal and complete the steps again.';
    case 'TOKEN_EXPIRED':
      return 'That verification key has expired. Start a new renewal.';
    case 'TOKEN_WRONG_LINK':
      return 'That key did not come from the Troxe Hosting link, so it cannot renew this server.';
    case 'TOKEN_ALREADY_USED':
      return 'That verification key has already been used.';
    case 'SESSION_EXPIRED':
      return 'This renewal attempt expired. Start a new one.';
    case 'SERVER_NOT_ELIGIBLE':
      return 'This server is not eligible for renewal.';
    case 'RATE_LIMITED':
      return 'Too many renewal attempts. Wait a moment and try again.';
    case 'PROVIDER_UNAVAILABLE':
      return 'The verification service is unreachable. Your server was not extended — please try again.';
    case 'PROVIDER_ERROR':
      return 'The verification service returned an unexpected response. Your server was not extended.';
    default:
      return 'The renewal could not be verified.';
  }
}