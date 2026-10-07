import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { randomToken, safeEqual, sha256 } from '../../common/crypto';
import { hashPassword, verifyPassword } from '../../common/password';
import { AppError, Err, pgCodeOf } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { authSessions, sessions, users, type User } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { GeoIpService } from '../../common/geoip/geoip.service';
import { LoginNotifyService, type LoginMethod } from '../email/login-notify.service';
import { EmailService } from '../email/email.service';
import { EmailVerificationService } from './email-verification.service';
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
    private loginNotify: LoginNotifyService,
    private email: EmailService,
    private verification: EmailVerificationService,
    private geo: GeoIpService,
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
    const name = dto.name.trim();
    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) {
      await this.audit.record({ actorEmail: email, action: 'auth.signup.duplicate', ip: ctx.ip, userAgent: ctx.device });
      throw Err.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    const nameTaken = await this.db.select({ id: users.id }).from(users).where(sql`lower(${users.name}) = ${name.toLowerCase()}`).limit(1);
    if (nameTaken.length) {
      await this.audit.record({ actorEmail: email, action: 'auth.signup.duplicate_name', ip: ctx.ip, userAgent: ctx.device });
      throw Err.conflict('NAME_TAKEN', 'This username is already taken');
    }

    const [user] = await this.db
      .insert(users)
      .values({ name, email, passwordHash: await this.hashPassword(dto.password) })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, passwordHash: users.passwordHash, tokenVersion: users.tokenVersion })
      .catch((e: unknown) => {
        // unique indexes: email + lower(name). The name race (two signups with
        // the same username) lands here too.
        if (pgCodeOf(e) === '23505') {
          const msg = JSON.stringify(e).includes('users_name_lower_unique')
            ? Err.conflict('NAME_TAKEN', 'This username is already taken')
            : Err.conflict('EMAIL_TAKEN', 'An account with this email already exists');
          throw msg;
        }
        throw e;
      });

    await this.recordLogin(user.id, ctx, 'success', 'password');
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
    // verification mail is best-effort: a dead mailer must never fail signup.
    // `sent:false` tells the UI to show the resend prompt instead.
    let emailVerification = { sent: false, already: false };
    if (this.email.enabled) {
      emailVerification = await this.verification.send(user.id, ctx).catch(() => ({ sent: false, already: false }));
    }
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
      emailVerification,
    };
  }

  async login(dto: LoginDto, ctx: ReqCtx) {
    const email = dto.email.toLowerCase().trim();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    // Deleted accounts are indistinguishable from wrong passwords (no oracle):
    // login simply never succeeds for them.
    if (user?.status === 'deleted') {
      await this.audit.record({ actorEmail: email, action: 'auth.login.fail.unknown', ip: ctx.ip, userAgent: ctx.device });
      throw Err.invalidCredentials();
    }

    // suspended / deleted accounts never get a session: suspended is told
    // plainly (dedicated UI), deleted looks like a wrong password (no oracle)
    if (user?.status === 'suspended') {
      await this.audit.record({ actorId: user.id, actorEmail: email, action: 'auth.login.suspended', ip: ctx.ip, userAgent: ctx.device });
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account has been suspended by the administration. If you believe this is a mistake, please contact support.');
    }

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
        await this.recordLogin(user.id, ctx, 'failed', 'password');
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

    await this.recordLogin(user.id, ctx, 'success', 'password');
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
    // fire-and-forget is wrong here: awaiting keeps ordering (login row lands
    // first), and the notifier itself never throws — a dead mailer only
    // appears in the audit trail, the login below always succeeds.
    await this.alertNewIp(user, ctx, 'password');
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
    // suspension survives OAuth too: no session, no new-account bypass — the
    // callback caller maps ACCOUNT_SUSPENDED to the suspended screen
    if (user.status === 'suspended') {
      await this.audit.record({ actorId: user.id, actorEmail: user.email, action: `auth.oauth.${provider}.suspended`, targetType: 'user', targetId: user.id, ip: ctx.ip, userAgent: ctx.device });
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account has been suspended by the administration. If you believe this is a mistake, please contact support.');
    }
    if (user.status === 'deleted') throw Err.unauthorized('USER_GONE');

    // a locked account stays locked no matter which door is used
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw Err.accountLocked(seconds);
    }

    await this.recordLogin(user.id, ctx, 'success', provider);
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
    await this.alertNewIp(user, ctx, provider);
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
      // suspended/deleted mid-session: kill the family instead of rotating
      if (user.status !== 'active') return { kind: 'suspended', familyId: row.familyId, userId: row.userId } as const;

      // rotate: same row/family, brand new secret. Presenting the CURRENT
      // secret preserves one grace step (a retried request re-issues instead
      // of wiping). Presenting the PREVIOUS secret consumes the grace: the new
      // rotation carries no prev hash, so any further use of a superseded
      // secret wipes the family instead of chaining fresh sessions forever.
      const secret = randomToken(32);
      const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SEC * 1000);
      await tx
        .update(authSessions)
        .set({
          prevRefreshTokenHash: current ? row.refreshTokenHash : null,
          prevRotatedAt: current ? new Date() : null,
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
    if (decision.kind === 'suspended') {
      await this.db.delete(authSessions).where(eq(authSessions.familyId, decision.familyId));
      await this.audit.record({ actorId: decision.userId, action: 'auth.refresh.suspended', targetType: 'user', targetId: decision.userId, ip: ctx.ip, userAgent: ctx.device });
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account has been suspended by the administration. If you believe this is a mistake, please contact support.');
    }
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

  private async recordLogin(userId: string, ctx: ReqCtx, status: 'success' | 'failed', method?: LoginMethod) {
    // GeoIP is offline (geoip-lite) and never throws — a lookup failure must
    // never break authentication. Private/loopback IPs stay NULL on purpose.
    const geo = this.geo.lookup(ctx.ip);
    await this.db.insert(sessions).values({
      userId,
      ip: ctx.ip,
      device: ctx.device,
      status,
      method: method ?? null,
      location: this.geo.formatLocation(geo),
      countryCode: geo?.countryCode ?? null,
    } as never);
  }

  /**
   * Best-effort new-IP security email. Runs AFTER the session is issued and
   * swallows everything: the notifier contract already degrades to audit
   * records, and this belt-and-suspenders catch means mail can never break
   * authentication, no matter what a future notifier throws.
   */
  private async alertNewIp(user: { id: string; email: string; name: string }, ctx: ReqCtx, method: LoginMethod): Promise<void> {
    try {
      await this.loginNotify.maybeNotify(user, ctx, method);
    } catch (e) {
      this.log.warn(`new-ip alert threw for ${user.id}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  /** Login history for the Overview page. */
  async history(userId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(20);

    // Rows recorded before GeoIP existed have NULL location — resolve lazily
    // and persist so the next read is a plain SELECT.
    for (const s of rows) {
      if (s.location || !s.ip) continue;
      const geo = this.geo.lookup(s.ip);
      if (!geo) continue;
      s.location = this.geo.formatLocation(geo);
      s.countryCode = geo.countryCode;
      this.db
        .update(sessions)
        .set({ location: s.location, countryCode: s.countryCode })
        .where(eq(sessions.id, s.id))
        .catch(() => undefined);
    }

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
