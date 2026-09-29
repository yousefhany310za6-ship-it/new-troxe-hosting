import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { config } from '../../config/env';
import { randomToken, safeEqual, sha256 } from '../../common/crypto';
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

  // ---- primitives -----------------------------------------------------------

  private hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(sha256(plain), config.BCRYPT_ROUNDS);
  }

  private checkPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(sha256(plain), hash);
  }

  private accessToken(user: { id: string; email: string; role: string }, sid: string): string {
    return this.jwt.sign(
      { sub: user.id, sid, email: user.email, role: user.role, typ: 'access' },
      { secret: config.JWT_ACCESS_SECRET, expiresIn: config.JWT_ACCESS_TTL },
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
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, passwordHash: users.passwordHash })
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

    // always run a bcrypt comparison so unknown emails take the same time
    const hash = user ? user.passwordHash : await this.dummyHash;
    const ok = await this.checkPassword(dto.password, hash);

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

    if (user.failedLogins || user.lockedUntil) {
      await this.db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
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

  // ---- refresh / logout -----------------------------------------------------

  async refresh(token: string | undefined, ctx: ReqCtx): Promise<IssuedSession> {
    const parsed = this.parseRefresh(token);
    if (!parsed) throw Err.unauthorized('INVALID_REFRESH');

    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, parsed.sid)).limit(1);
    const presented = sha256(parsed.secret);

    if (!row) throw Err.unauthorized('INVALID_REFRESH');

    // replay of an already-rotated token → assume theft, kill the whole family
    if (!safeEqual(presented, row.refreshTokenHash)) {
      await this.db.delete(authSessions).where(eq(authSessions.familyId, row.familyId));
      await this.audit.record({
        actorId: row.userId,
        action: 'auth.refresh.reuse',
        targetType: 'auth_session',
        targetId: row.familyId,
        ip: ctx.ip,
        userAgent: ctx.device,
      });
      this.log.warn(`refresh-token reuse detected for family ${row.familyId}`);
      throw Err.unauthorized('REFRESH_REUSED');
    }

    if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      await this.db.delete(authSessions).where(eq(authSessions.familyId, row.familyId));
      throw Err.unauthorized('REFRESH_EXPIRED');
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user) throw Err.unauthorized('USER_GONE');

    // rotate: same row/family, brand new secret
    const secret = randomToken(32);
    const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SEC * 1000);
    await this.db
      .update(authSessions)
      .set({ refreshTokenHash: sha256(secret), expiresAt, lastUsedAt: new Date(), ip: ctx.ip, device: ctx.device })
      .where(eq(authSessions.id, row.id));

    return {
      accessToken: this.accessToken({ id: user.id, email: user.email, role: user.role }, row.id),
      refreshToken: `${row.id}.${secret}`,
      sessionId: row.id,
      expiresAt,
    };
  }

  async logout(token: string | undefined, ctx: ReqCtx): Promise<void> {
    const parsed = this.parseRefresh(token);
    if (!parsed) return;
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, parsed.sid)).limit(1);
    if (!row) return;
    await this.db.delete(authSessions).where(eq(authSessions.familyId, row.familyId));
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
    const rows = await this.db
      .delete(authSessions)
      .where(eq(authSessions.userId, userId))
      .returning({ id: authSessions.id });
    return rows.length;
  }

  // ---- helpers --------------------------------------------------------------

  private async newRefreshSession(
    user: { id: string; email: string; role: string },
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
    const count = user.failedLogins + 1;
    let lockedSeconds = 0;
    if (count >= config.LOCKOUT_THRESHOLD) {
      const step = count - config.LOCKOUT_THRESHOLD; // 0,1,2,...
      lockedSeconds = Math.min(30 * 2 ** step, 900); // 30s → 15m cap
    }
    await this.db
      .update(users)
      .set({
        failedLogins: count,
        lockedUntil: lockedSeconds ? new Date(Date.now() + lockedSeconds * 1000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
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
