import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { TOTP } from 'otpauth';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import { encryptSecret, decryptSecret, randomToken, sha256 } from '../../common/crypto';
import { DB, Db } from '../../db/db.module';
import { mfaChallenges, recoveryCodes, twoFactorSecrets, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';

const CHALLENGE_TTL_MS = () => config.MFA_CHALLENGE_TTL_SEC * 1000;
const MAX_FAILURES = () => config.MFA_MAX_FAILURES;
const LOCKOUT_MS = () => config.MFA_LOCKOUT_SEC * 1000;
const RECOVERY_COUNT = () => config.RECOVERY_CODE_COUNT;

@Injectable()
export class TwoFactorService {
  private readonly log = new Logger(TwoFactorService.name);

  constructor(
    @Inject(DB) private db: Db,
    private audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ status

  async getStatus(userId: string) {
    const [row] = await this.db
      .select({ enabled: twoFactorSecrets.enabled })
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    const [{ count }] = await this.db
      .select({ count: recoveryCodes.id })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
      .limit(1)
      .then((r) => [{ count: r.length }]);
    return { enabled: row?.enabled ?? false, unusedRecoveryCodes: count };
  }

  // ------------------------------------------------------------------ setup

  /**
   * Step 1: generate a TOTP secret. NOT enabled yet — the user must verify
   * a code before 2FA is activated. The secret is encrypted at rest.
   */
  async startSetup(userId: string) {
    const [existing] = await this.db
      .select({ enabled: twoFactorSecrets.enabled })
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    if (existing?.enabled) throw Err.conflict('TWO_FACTOR_ALREADY_ENABLED');

    const totp = new TOTP({ issuer: 'Troxe Hosting', digits: 6, period: 30 });
    const secret = totp.secret.base32;
    const otpauthUrl = totp.toString();

    await this.db
      .insert(twoFactorSecrets)
      .values({ userId, secretEnc: encryptSecret(secret), enabled: false })
      .onConflictDoUpdate({
        target: twoFactorSecrets.userId,
        set: { secretEnc: encryptSecret(secret), enabled: false, updatedAt: new Date() },
      });

    return { secret, otpauthUrl };
  }

  /**
   * Step 2: verify the TOTP code. On success, 2FA is enabled and recovery
   * codes are generated (shown once, stored hashed).
   */
  async confirmSetup(userId: string, code: string, ctx: { ip: string; userAgent?: string }) {
    const [row] = await this.db
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    if (!row) throw Err.invalid('TWO_FACTOR_NOT_SETUP', 'Start 2FA setup first');
    if (row.enabled) throw Err.conflict('TWO_FACTOR_ALREADY_ENABLED');

    const secret = decryptSecret<string>(row.secretEnc);
    if (!this.verifyTotp(secret, code, row.lastUsedCounter)) {
      await this.audit.record({
        actorId: userId,
        action: 'user.2fa.setup_failed',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw Err.invalid('TWO_FACTOR_CODE_INVALID', 'Invalid verification code');
    }

    await this.db
      .update(twoFactorSecrets)
      .set({ enabled: true, lastUsedCounter: this.counterFromCode(secret, code), updatedAt: new Date() })
      .where(eq(twoFactorSecrets.userId, userId));

    const codes = await this.generateRecoveryCodes(userId);
    await this.audit.record({
      actorId: userId,
      action: 'user.2fa.enabled',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { recoveryCodes: codes };
  }

  // ------------------------------------------------------------------ disable

  /**
   * Disable 2FA. Requires password re-authentication + TOTP or recovery code.
   * Revokes all recovery codes and invalidates pending challenges.
   */
  async disable(userId: string, code: string, ctx: { ip: string; userAgent?: string }) {
    const [row] = await this.db
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    if (!row?.enabled) throw Err.invalid('TWO_FACTOR_NOT_ENABLED');

    const secret = decryptSecret<string>(row.secretEnc);
    const isTotp = this.verifyTotp(secret, code, row.lastUsedCounter);
    const isRecovery = await this.consumeRecoveryCode(userId, code);

    if (!isTotp && !isRecovery) {
      await this.registerFailure(userId, ctx, 'user.2fa.disable_failed');
      throw Err.invalid('TWO_FACTOR_CODE_INVALID', 'Invalid code');
    }

    await this.db.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId));
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await this.db.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));

    await this.audit.record({
      actorId: userId,
      action: 'user.2fa.disabled',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  // -------------------------------------------------------- recovery codes

  /**
   * Regenerate recovery codes. Requires password + 2FA. Old codes are
   * deleted atomically; new codes are shown once.
   */
  async regenerateRecoveryCodes(userId: string, code: string, ctx: { ip: string; userAgent?: string }) {
    const [row] = await this.db
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    if (!row?.enabled) throw Err.invalid('TWO_FACTOR_NOT_ENABLED');

    const secret = decryptSecret<string>(row.secretEnc);
    const isTotp = this.verifyTotp(secret, code, row.lastUsedCounter);
    const isRecovery = await this.consumeRecoveryCode(userId, code);

    if (!isTotp && !isRecovery) {
      await this.registerFailure(userId, ctx, 'user.2fa.recovery_regen_failed');
      throw Err.invalid('TWO_FACTOR_CODE_INVALID', 'Invalid code');
    }

    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    const codes = await this.generateRecoveryCodes(userId);
    await this.audit.record({
      actorId: userId,
      action: 'user.2fa.recovery_regenerated',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { recoveryCodes: codes };
  }

  // -------------------------------------------------------------- challenges

  /**
   * Create a temporary 2FA challenge after password/OAuth verification.
   * The challenge is single-use, short-lived, and bound to the user.
   */
  async createChallenge(userId: string, ctx: { ip: string; userAgent?: string }) {
    const id = randomToken(16);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS());
    await this.db.insert(mfaChallenges).values({
      id,
      userId,
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { challengeId: id, expiresAt };
  }

  /**
   * Complete a 2FA challenge with a TOTP or recovery code.
   * Single-use: the challenge is consumed atomically.
   */
  async completeChallenge(challengeId: string, code: string, ctx: { ip: string; userAgent?: string }) {
    const [challenge] = await this.db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.id, challengeId))
      .limit(1);

    if (!challenge || challenge.expiresAt.getTime() < Date.now() || challenge.consumedAt) {
      throw Err.invalid('TWO_FACTOR_CHALLENGE_INVALID', 'Challenge expired or already used');
    }

    // atomically consume — prevents replay
    const [consumed] = await this.db
      .update(mfaChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaChallenges.id, challengeId), isNull(mfaChallenges.consumedAt)))
      .returning();
    if (!consumed) throw Err.invalid('TWO_FACTOR_CHALLENGE_INVALID', 'Challenge already used');

    const [row] = await this.db
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, challenge.userId))
      .limit(1);
    if (!row?.enabled) throw Err.invalid('TWO_FACTOR_NOT_ENABLED');

    const secret = decryptSecret<string>(row.secretEnc);
    const isTotp = this.verifyTotp(secret, code, row.lastUsedCounter);
    const isRecovery = await this.consumeRecoveryCode(challenge.userId, code);

    if (!isTotp && !isRecovery) {
      await this.registerFailure(challenge.userId, ctx, 'user.2fa.verify_failed');
      throw Err.invalid('TWO_FACTOR_CODE_INVALID', 'Invalid code');
    }

    await this.audit.record({
      actorId: challenge.userId,
      action: 'user.2fa.challenge_completed',
      targetType: 'user',
      targetId: challenge.userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { userId: challenge.userId };
  }

  // -------------------------------------------------- sensitive-action gate

  /**
   * Verify 2FA for a sensitive action (password change, account deletion, etc.).
   * Returns true if 2FA is not enabled (no gate needed).
   */
  async verifyForSensitiveAction(userId: string, code: string, ctx: { ip: string; userAgent?: string }) {
    const [row] = await this.db
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    if (!row?.enabled) return true;

    const secret = decryptSecret<string>(row.secretEnc);
    const isTotp = this.verifyTotp(secret, code, row.lastUsedCounter);
    const isRecovery = await this.consumeRecoveryCode(userId, code);

    if (!isTotp && !isRecovery) {
      await this.registerFailure(userId, ctx, 'user.2fa.sensitive_action_failed');
      throw Err.invalid('TWO_FACTOR_CODE_INVALID', 'Invalid code');
    }
    return true;
  }

  // -------------------------------------------------------------- internals

  private currentCounter(): number {
    return Math.floor(Date.now() / 1000 / 30);
  }

  private verifyTotp(secret: string, code: string, lastCounter: number): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    // validate with a ±1 window for clock drift
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) return false;
    const counter = this.currentCounter() + delta;
    // replay protection: reject codes at or before the last used counter
    if (counter <= lastCounter) return false;
    return true;
  }

  private counterFromCode(secret: string, code: string): number {
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    const delta = totp.validate({ token: code, window: 1 });
    return delta === null ? 0 : this.currentCounter() + delta;
  }

  private async generateRecoveryCodes(userId: string): Promise<string[]> {
    const count = RECOVERY_COUNT();
    const codes: string[] = [];
    const values: { userId: string; codeHash: string }[] = [];
    for (let i = 0; i < count; i++) {
      const code = randomBytes(6).toString('base64url').slice(0, 10).toUpperCase();
      codes.push(code);
      values.push({ userId, codeHash: sha256(code) });
    }
    await this.db.insert(recoveryCodes).values(values);
    return codes;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const hash = sha256(code);
    const [row] = await this.db
      .select()
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
      .limit(1);
    if (!row) return false;
    await this.db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(eq(recoveryCodes.id, row.id));
    await this.audit.record({
      actorId: userId,
      action: 'user.2fa.recovery_used',
      targetType: 'user',
      targetId: userId,
    });
    return true;
  }

  private async registerFailure(userId: string, ctx: { ip: string; userAgent?: string }, action: string) {
    await this.audit.record({
      actorId: userId,
      action,
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    // check if we should lock out
    const [{ count }] = await this.db
      .select({ count: mfaChallenges.id })
      .from(mfaChallenges)
      .where(and(eq(mfaChallenges.userId, userId), gt(mfaChallenges.createdAt, new Date(Date.now() - LOCKOUT_MS()))))
      .limit(1)
      .then((r) => [{ count: r.length }]);
    if (count >= MAX_FAILURES()) {
      await this.audit.record({
        actorId: userId,
        action: 'user.2fa.locked',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        meta: { lockoutSec: config.MFA_LOCKOUT_SEC },
      });
      throw new AppError('TWO_FACTOR_LOCKED', 429, `Too many failed attempts. Try again in ${Math.ceil(config.MFA_LOCKOUT_SEC / 60)} minutes.`);
    }
  }
}
