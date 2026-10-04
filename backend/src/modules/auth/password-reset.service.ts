import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { config } from '../../config/env';
import { randomToken, sha256 } from '../../common/crypto';
import { hashPassword } from '../../common/password';
import { Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { passwordResetTokens, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';

const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;

/**
 * Password reset. Enumeration-proof: the request endpoint always answers
 * `{ok:true}` whether the address exists or not, and confirm errors are a
 * single generic message. Tokens are random, hashed at rest, single-use,
 * hourly expiring — and never logged, returned, or embedded anywhere except
 * the one reset URL built from APP_URL (never the Host header).
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DB) private db: Db,
    private email: EmailService,
    private audit: AuditService,
    private auth: AuthService,
  ) {}

  async request(email: string, ctx: ReqCtx): Promise<{ ok: true }> {
    const normalized = email.toLowerCase().trim().slice(0, 255);
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
    if (valid) {
      const [u] = await this.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1)
        .catch(() => [undefined]);
      if (u) {
        // per-address throttle (the endpoint throttle is per-IP): targeted
        // bombing of one inbox is silently absorbed past the hourly budget
        const recent = await this.db
          .select({ id: passwordResetTokens.id })
          .from(passwordResetTokens)
          .where(
            and(
              eq(passwordResetTokens.userId, u.id),
              gt(passwordResetTokens.createdAt, new Date(Date.now() - 3600_000)),
            ),
          )
          .limit(MAX_REQUESTS_PER_HOUR + 1)
          .catch(() => []);
        if (recent.length <= MAX_REQUESTS_PER_HOUR && config.APP_URL) {
          // invalidate previous unused tokens, then mint one
          await this.db
            .delete(passwordResetTokens)
            .where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt)))
            .catch(() => undefined);
          const token = randomToken(32);
          await this.db
            .insert(passwordResetTokens)
            .values({ userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) })
            .catch(() => undefined);
          const url = `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
          try {
            await this.email.sendPasswordResetEmail(u.email, u.name, url);
          } catch (e) {
            this.log.warn(`reset email failed for ${u.id}: ${(e as Error).message.slice(0, 120)}`);
          }
        }
      }
    }
    // identical response in every case: existing, missing, or malformed email
    await this.audit
      .record({ actorEmail: valid ? normalized : undefined, action: 'auth.password.reset.request', ip: ctx.ip, userAgent: ctx.device })
      .catch(() => undefined);
    return { ok: true };
  }

  async confirm(token: string, next: string, confirm: string, ctx: ReqCtx): Promise<{ ok: true }> {
    const fail = 'This reset link is invalid or has expired';
    if (typeof token !== 'string' || !token || token.length > 512) throw Err.invalid('RESET_INVALID', fail);
    if (next !== confirm) throw Err.invalid('PASSWORDS_MISMATCH', 'Passwords do not match');
    if (next.length < 8 || next.length > 128 || !/^(?=.*[A-Za-z])(?=.*\d).+$/.test(next))
      throw Err.invalid('PASSWORD_TOO_SIMPLE', 'Password must be 8+ characters with letters and numbers');

    const [row] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, sha256(token)))
      .limit(1);
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw Err.invalid('RESET_INVALID', fail);

    const [u] = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!u) throw Err.invalid('RESET_INVALID', fail);

    await this.db.transaction(async (tx) => {
      const [fresh] = await tx
        .select({ usedAt: passwordResetTokens.usedAt, expiresAt: passwordResetTokens.expiresAt })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, row.id))
        .for('update')
        .limit(1);
      if (!fresh || fresh.usedAt || fresh.expiresAt.getTime() <= Date.now()) throw Err.invalid('RESET_INVALID', fail);
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null, failedSince: null })
        .where(eq(users.id, u.id));
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
      await tx.delete(passwordResetTokens).where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt)));
    });
    // a reset password must kill every other session (the requester proves
    // ownership via the emailed link; the resetter's own session is re-issued
    // by their next login)
    const revoked = await this.auth.revokeAllForUser(u.id).catch(() => 0);
    await this.audit
      .record({
        actorId: u.id,
        actorEmail: u.email,
        action: 'auth.password.reset.success',
        targetType: 'user',
        targetId: u.id,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { revokedSessions: revoked },
      })
      .catch(() => undefined);
    return { ok: true };
  }
}
