import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { safeEqual, sha256 } from '../../common/crypto';
import { AppError, Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { emailVerifications, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { EmailService } from '../email/email.service';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Email verification with 6-digit codes. The code itself is never stored
 * (sha256 only), never logged, single-use, short-lived, and attempt-counted:
 * five wrong guesses invalidate the row. Resending invalidates the previous
 * code and is cooldown-gated on top of endpoint throttling.
 */
@Injectable()
export class EmailVerificationService {
  private readonly log = new Logger(EmailVerificationService.name);

  constructor(
    @Inject(DB) private db: Db,
    private email: EmailService,
    private audit: AuditService,
  ) {}

  private newCode(): string {
    return String(randomInt(100_000, 1_000_000));
  }

  async send(userId: string, ctx: ReqCtx): Promise<{ sent: boolean; already: boolean }> {
    const [u] = await this.db
      .select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) throw Err.unauthorized('USER_GONE');
    if (u.emailVerified) return { sent: false, already: true };

    const [latest] = await this.db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, userId))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS)
      throw Err.tooMany('VERIFY_COOLDOWN');

    // invalidate the previous code before minting a new one
    await this.db.delete(emailVerifications).where(eq(emailVerifications.userId, userId));

    const code = this.newCode();
    const [row] = await this.db
      .insert(emailVerifications)
      .values({ userId, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) })
      .returning({ id: emailVerifications.id });
    try {
      await this.email.sendVerificationEmail(u.email, u.name, code);
    } catch (e) {
      // don't leave a row the user can never receive: roll the mint back
      await this.db.delete(emailVerifications).where(eq(emailVerifications.id, row.id)).catch(() => undefined);
      this.log.warn(`verification email failed for ${userId}: ${(e as Error).message.slice(0, 120)}`);
      throw e instanceof AppError ? e : Err.unavailable('EMAIL_UPSTREAM', 'Could not send the code — please retry');
    }
    await this.audit
      .record({
        actorId: userId,
        actorEmail: u.email,
        action: 'auth.email.verify.sent',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
        userAgent: ctx.device,
      })
      .catch(() => undefined);
    return { sent: true, already: false };
  }

  async verify(userId: string, code: string, ctx: ReqCtx): Promise<{ verified: boolean }> {
    const fail = 'Invalid or expired code';
    if (!/^\d{6}$/.test(code.trim())) throw Err.invalid('VERIFY_INVALID', fail);
    const [u] = await this.db
      .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) throw Err.unauthorized('USER_GONE');
    if (u.emailVerified) return { verified: true };

    const [row] = await this.db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, userId))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);
    const expired = !row || row.expiresAt.getTime() <= Date.now();
    const exhausted = !!row && row.attempts >= MAX_ATTEMPTS;
    if (expired || exhausted) {
      if (row) await this.db.delete(emailVerifications).where(eq(emailVerifications.id, row.id)).catch(() => undefined);
      throw Err.invalid('VERIFY_INVALID', fail);
    }

    const ok = safeEqual(sha256(code.trim()), row.codeHash);
    if (!ok) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.db.delete(emailVerifications).where(eq(emailVerifications.id, row.id)).catch(() => undefined);
      } else {
        await this.db.update(emailVerifications).set({ attempts }).where(eq(emailVerifications.id, row.id)).catch(() => undefined);
      }
      await this.audit
        .record({ actorId: userId, actorEmail: u.email, action: 'auth.email.verify.fail', targetType: 'user', targetId: userId, ip: ctx.ip, userAgent: ctx.device })
        .catch(() => undefined);
      throw Err.invalid('VERIFY_INVALID', fail);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerified: true, emailVerifiedAt: new Date() }).where(eq(users.id, userId));
      await tx.delete(emailVerifications).where(eq(emailVerifications.userId, userId));
    });
    await this.audit
      .record({ actorId: userId, actorEmail: u.email, action: 'auth.email.verify.success', targetType: 'user', targetId: userId, ip: ctx.ip, userAgent: ctx.device })
      .catch(() => undefined);
    return { verified: true };
  }
}
