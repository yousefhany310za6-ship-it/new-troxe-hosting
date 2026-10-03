import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { randomToken, safeEqual, sha256 } from '../../common/crypto';
import { hashPassword, verifyPassword } from '../../common/password';
import { Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { authSessions, sessions, users, type User } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { LoginDto, SignupDto } from './dto';

/** `<sessionId>.<48-byte secret>` — opaque, high entropy, versionless */
const REFRESH_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{20,128})$/;

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Authentication with rotating refresh tokens + theft detection.
 *
 * Guarantees:
 *  - access tokens are 15-minute JWTs, useless for session renewal
 *  - refresh tokens are opaque, stored only as sha256, single-use (rotated)
 *  - replaying an old refresh token revokes the entire session family
 *  - passwords are pre-hashed (sha256) before bcrypt → fixes bcrypt's 72-byte
 *    truncation and allows long passphrases
 *  - constant-time login (unknown emails still pay a bcrypt round)
 *  - progressive per-account lockout on repeated failures
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  /** compared against when the account does not exist, to equalise timing */
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(DB) private db: Db,
    private jwt: JwtService,
    private audit: AuditService,
  ) {
    this.dummyHash = bcrypt.hash(randomToken(32), config.BCRYPT_ROUNDS);
  }

  // ---- primitives (canonical: ../../common/password) ------------------------

  private hashPassword(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  private checkPassword(plain: string, hash: string): Promise<boolean> {
    return verifyPassword(plain, hash);
  }

  private accessToken(
    user: { id: string; email: string; role: string; tokenVersion: number },
    sid: string,
  ): string {
    return this.jwt.sign(
      { sub: user.id, sid, email: user.email, role: user.role, typ: 'access', v: user.tokenVersion },
      { secret: config.JWT_ACCESS_SECRET, expiresIn: config.JWT_ACCESS_TTL, algorithm: 'HS256' },
    );
  }

  private parseRefresh(token: string | undefined): { sid: string; secret: string } | null {
    if (!token || token.length > 512) return null;
    const m = REFRESH_RE.exec(token);
    if (!m) return null;
    return { sid: m[1], secret: m[2] };
  }

  // ---- signup / login -------------------------------------------------------

  async signup(dto: SignupDto, ctx: ReqCtx) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) {
      await this.audit.record({ actorEmail: email, action: 'auth.signup.duplicate', ip: ctx.ip, userAgent: ctx.device });
      throw Err.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }

    const [user] = await this.db
      .insert(users)
      .values({ name: dto.name.trim(), email, passwordHash: await this.hashPassword(dto.password) })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, passwordHash: users.passwordHash, tokenVersion: users.tokenVersion })
      .catch((e: { code?: string }) => {
        if (e?.code === '23505') throw Err.conflict('EMAIL_TAKEN', 'An account with this email already exists');
        throw e;
      });

    await this.recordLogin(user.id, ctx, 'success');
    const issued = await this.newRefreshSession(user, ctx);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.signup',
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.device,
    });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
    };
  }

  async login(dto: LoginDto, ctx: ReqCtx) {
    const email = dto.email.toLowerCase().trim();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    // account lockout is checked first: locked accounts stop paying for bcrypt
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      await this.audit.record({ actorId: user.id, actorEmail: email, action: 'auth.login.locked', ip: ctx.ip, userAgent: ctx.device });
      throw Err.accountLocked(seconds);
    }

    // always run a bcrypt comparison so unknown emails take the same time.
    // OAuth-only accounts have a NULL hash: they can never pass a password
    // check (the dummy comparison still runs to keep timing flat).
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const ok = !!user?.passwordHash && (await this.checkPassword(dto.password, hash));

    if (!user || !ok) {
      if (user) {
        const lockedSeconds = await this.registerFailure(user);
        await this.recordLogin(user.id, ctx, 'failed');
        await this.audit.record({
          actorId: user.id,
          actorEmail: email,
          action: 'auth.login.fail',
          ip: ctx.ip,
          userAgent: ctx.device,
          meta: { lockedSeconds },
        });
        if (lockedSeconds) throw Err.accountLocked(lockedSeconds);
      } else {
        await this.audit.record({ actorEmail: email, action: 'auth.login.fail.unknown', ip: ctx.ip, userAgent: ctx.device });
      }
      throw Err.invalidCredentials();
    }

    if (user.failedLogins || user.lockedUntil || user.failedSince) {
      await this.db
        .update(users)
        .set({ failedLogins: 0, lockedUntil: null, failedSince: null })
        .where(eq(users.id, user.id));
    }

    await this.recordLogin(user.id, ctx, 'success');
    const issued = await this.newRefreshSession(user, ctx);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login.success',
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.device,
    });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
    };
  }

  // ---- OAuth session issuance ----------------------------------------------

  /**
   * Open a full session for an already-verified OAuth identity. The provider
   * did the authentication; this only mints our own tokens (same rotation
   * family mechanics as password login) and records login history + audit.
   * Callers must have verified the provider tokens server-side first.
   */
  async openSession(userId: string, ctx: ReqCtx, provider: 'google' | 'discord') {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw Err.unauthorized('USER_GONE');

    // a locked account stays locked no matter which door is used
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw Err.accountLocked(seconds);
    }

    await this.recordLogin(user.id, ctx, 'success');
    const issued = await this.newRefreshSession(user, ctx);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: `auth.oauth.${provider}.login`,
      targetType: 'user',
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.device,
    });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
    };
  }

  // ---- refresh / logout -----------------------------------------------------

  async refresh(token: string | undefined, ctx: ReqCtx): Promise<IssuedSession> {
    const parsed = this.parseRefresh(token);
    if (!parsed) throw Err.unauthorized('INVALID_REFRESH');
    const presented = sha256(parsed.secret);

    // Whole rotation is ONE transaction holding a row lock on the session:
    // concurrent uses of the same token serialize here, so theft detection
    // can never be bypassed by a race (TOCTOU), and a duplicate request can
    // never corrupt the stored secret.
    //
    // NOTE: family wipes happen OUTSIDE the transaction below. A throw
    // inside `transaction()` rolls everything back — including the wipe —
    // which would silently resurrect a compromised family.
    const decision = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(authSessions).where(eq(authSessions.id, parsed.sid)).for('update').limit(1);
      if (!row) return { kind: 'invalid' } as const;

      const current = safeEqual(presented, row.refreshTokenHash);
      const inGrace =
        !!row.prevRefreshTokenHash &&
        !!row.prevRotatedAt &&
        safeEqual(presented, row.prevRefreshTokenHash) &&
        Date.now() - row.prevRotatedAt.getTime() < 60_000;

      if (!current && !inGrace) {
        // replay of a superseded secret outside grace (or a forged one) →
        // assume theft, kill the whole family (outside, see NOTE).
        return { kind: 'reuse', familyId: row.familyId, userId: row.userId } as const;
      }

      if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
        return { kind: 'expired', familyId: row.familyId } as const;
      }

      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user) return { kind: 'gone' } as const;

      // rotate: same row/family, brand new secret; the superseded hash stays
      // valid for 60s so a retried request re-issues instead of wiping.
      const secret = randomToken(32);
      const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SEC * 1000);
      await tx
        .update(authSessions)
        .set({
          prevRefreshTokenHash: row.refreshTokenHash,
          prevRotatedAt: new Date(),
          refreshTokenHash: sha256(secret),
          expiresAt,
          lastUsedAt: new Date(),
          ip: ctx.ip,
          device: ctx.device,
        })
        .where(eq(authSessions.id, row.id));

      return {
        kind: 'ok',
        accessToken: this.accessToken(
          { id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion },
          row.id,
        ),
        refreshToken: `${row.id}.${secret}`,
        sessionId: row.id,
        expiresAt,
      } as const;
    });

    if (decision.kind === 'invalid') throw Err.unauthorized('INVALID_REFRESH');
    if (decision.kind === 'gone') throw Err.unauthorized('USER_GONE');
    if (decision.kind === 'expired') {
      await this.db.delete(authSessions).where(eq(authSessions.familyId, decision.familyId));
      throw Err.unauthorized('REFRESH_EXPIRED');
    }
    if (decision.kind === 'reuse') {
      await this.db.delete(authSessions).where(eq(authSessions.familyId, decision.familyId));
      await this.audit.record({
        actorId: decision.userId,
        action: 'auth.refresh.reuse',
        targetType: 'auth_session',
        targetId: decision.familyId,
        ip: ctx.ip,
        userAgent: ctx.device,
      });
      this.log.warn(`refresh-token reuse detected for family ${decision.familyId}`);
      throw Err.unauthorized('REFRESH_REUSED');
    }
    return {
      accessToken: decision.accessToken,
      refreshToken: decision.refreshToken,
      sessionId: decision.sessionId,
      expiresAt: decision.expiresAt,
    };
  }

  async logout(token: string | undefined, ctx: ReqCtx): Promise<void> {
    const parsed = this.parseRefresh(token);
    if (!parsed) return;
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, parsed.sid)).limit(1);
    if (!row) return;
    await this.db.delete(authSessions).where(eq(authSessions.familyId, row.familyId));
    // kill outstanding access tokens too — other sessions transparently
    // re-issue via their intact refresh tokens on next 401.
    await this.db
      .update(users)
      .set({ tokenVersion: sql`token_version + 1` })
      .where(eq(users.id, row.userId));
    await this.audit.record({
      actorId: row.userId,
      action: 'auth.logout',
      targetType: 'auth_session',
      targetId: row.familyId,
      ip: ctx.ip,
      userAgent: ctx.device,
    });
  }

  /** Used after a password change / "sign out everywhere". */
  async revokeAllForUser(userId: string): Promise<number> {
    // bump the token generation first: outstanding access tokens die
    // immediately, even before the rows below are gone.
    await this.db
      .update(users)
      .set({ tokenVersion: sql`token_version + 1` })
      .where(eq(users.id, userId));
    const rows = await this.db
      .delete(authSessions)
      .where(eq(authSessions.userId, userId))
      .returning({ id: authSessions.id });
    return rows.length;
  }

  // ---- helpers --------------------------------------------------------------

  private async newRefreshSession(
    user: { id: string; email: string; role: string; tokenVersion: number },
    ctx: ReqCtx,
  ): Promise<IssuedSession> {
    const secret = randomToken(32);
    const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SEC * 1000);
    const [row] = await this.db
      .insert(authSessions)
      .values({
        familyId: randomUUID(), // one browser session = one rotation family
        userId: user.id,
        refreshTokenHash: sha256(secret),
        ip: ctx.ip,
        device: ctx.device,
        expiresAt,
      })
      .returning({ id: authSessions.id });

    return {
      accessToken: this.accessToken(user, row.id),
      refreshToken: `${row.id}.${secret}`,
      sessionId: row.id,
      expiresAt,
    };
  }

  private async registerFailure(user: User): Promise<number> {
    // Decay-aware, fully atomic increment in ONE statement:
    //  - failures older than LOCKOUT_DECAY_SEC restart the streak (count 1,
    //    new streak start), so scattered typos never accumulate into a lock;
    //  - a burst inside the window increments as before (lost-update safe:
    //    concurrent failures cannot overwrite each other and dodge the
    //    threshold), and streak start + counter always move together.
    // All clock values are DB-side (`now()`), never mixed with the API clock.
    const windowSec = Number(config.LOCKOUT_DECAY_SEC);
    const stale = sql`(failed_since is null or failed_since < now() - interval '${sql.raw(String(windowSec))} second')`;
    const [updated] = await this.db
      .update(users)
      .set({
        failedSince: sql`case when ${stale} then now() else failed_since end`,
        failedLogins: sql`case when ${stale} then 1 else failed_logins + 1 end`,
      })
      .where(eq(users.id, user.id))
      .returning({ failedLogins: users.failedLogins, lockedUntil: users.lockedUntil });
    const count = updated?.failedLogins ?? user.failedLogins + 1;
    let lockedSeconds = 0;
    if (count >= config.LOCKOUT_THRESHOLD) {
      const step = count - config.LOCKOUT_THRESHOLD; // 0,1,2,...
      lockedSeconds = Math.min(30 * 2 ** step, 900); // 30s → 15m cap
    }
    if (lockedSeconds) {
      await this.db
        .update(users)
        .set({ lockedUntil: new Date(Date.now() + lockedSeconds * 1000) })
        .where(eq(users.id, user.id));
    }
    return lockedSeconds;
  }

  private async recordLogin(userId: string, ctx: ReqCtx, status: 'success' | 'failed') {
    await this.db.insert(sessions).values({
      userId,
      ip: ctx.ip,
      device: ctx.device,
      status,
      location: null,
      countryCode: null,
    } as never);
  }

  /** Login history for the Overview page. */
  async history(userId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(20);

    const fmt = (s: (typeof rows)[number]) => ({
      id: s.id,
      status: s.status,
      ip: s.ip,
      location: s.location ?? 'Unknown',
      countryCode: s.countryCode ?? 'xx',
      device: s.device,
      createdAt: s.createdAt,
    });

    const currentSuccess = rows.find((s) => s.status === 'success');
    return { current: currentSuccess ? fmt(currentSuccess) : null, history: rows.map(fmt) };
  }

  /** Active refresh sessions of a user (security page). */
  async activeSessions(userId: string) {
    const rows = await this.db
      .select({
        id: authSessions.id,
        ip: authSessions.ip,
        device: authSessions.device,
        createdAt: authSessions.createdAt,
        lastUsedAt: authSessions.lastUsedAt,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
      .orderBy(desc(authSessions.lastUsedAt))
      .limit(50);
    return rows;
  }

  async logoutAll(userId: string, ctx: ReqCtx): Promise<number> {
    const n = await this.revokeAllForUser(userId);
    await this.audit.record({
      actorId: userId,
      action: 'auth.logout_all',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: { revoked: n },
    });
    return n;
  }
}
