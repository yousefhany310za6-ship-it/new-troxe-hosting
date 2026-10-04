import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Err } from '../../common/errors';
import { hashPassword, verifyPassword } from '../../common/password';
import { DB, Db } from '../../db/db.module';
import { auditLogs, users, oauthAccounts } from '../../db/schema';
import { config } from '../../config/env';
import { httpsUrlOk } from '../auth/oauth/oauth.helpers';
import { verifyUnsubscribe } from '../email/email.tokens';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../auth/auth.service';
import { ServersService } from '../servers/servers.service';
import { UpdateNotificationsDto, UpdatePasswordDto, UpdateProfileDto, DeleteAccountDto, SetPasswordDto } from './dto';

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    @Inject(DB) private db: Db,
    private auth: AuthService,
    private audit: AuditService,
    private servers: ServersService,
  ) {}

  private strip(u: typeof users.$inferSelect) {
    const { passwordHash: _ph, failedLogins: _fl, lockedUntil: _lu, tokenVersion: _tv, ...safe } = u;
    return safe;
  }

  async me(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Err.unauthorized('USER_GONE');
    return this.strip(u);
  }

  /** Own audit trail for the Activity page (newest first, capped). */
  async activity(userId: string, page = 1, limit = 30) {
    const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 100);
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 30, 1), 100);
    const rows = await this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.actorId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit + 1)
      .offset((safePage - 1) * safeLimit);
    return { data: rows.slice(0, safeLimit), hasMore: rows.length > safeLimit, page: safePage };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const email = dto.email.toLowerCase().trim();
    const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw Err.unauthorized('USER_GONE');

    // an email change re-points recovery: it must be confirmed with the
    // password (a stolen short-lived token alone cannot persist a hijack).
    // OAuth-only accounts have no password — they must set one first.
    if (email !== existing.email) {
      if (!existing.passwordHash) throw Err.invalid('PASSWORD_REQUIRED', 'Set a password before changing your email');
      if (!dto.current || !(await verifyPassword(dto.current, existing.passwordHash))) {
        await this.audit.record({
          actorId: userId,
          actorEmail: existing.email,
          action: 'user.email.fail',
          targetType: 'user',
          targetId: userId,
        });
        throw new BadRequestException('WRONG_CURRENT_PASSWORD');
      }
    }
    try {
      // email change re-points recovery: bump the token generation like a
      // role change does, so outstanding access JWTs (which carry the old
      // email claim) die instead of lingering up to TTL.
      const emailChanged = email !== existing.email;
      const patch: { name: string; email: string; avatarUrl?: string | null } = { name: dto.name.trim(), email };
      if (dto.avatarUrl !== undefined) {
        if (dto.avatarUrl === '') {
          patch.avatarUrl = null; // explicit clear
        } else {
          const ok = httpsUrlOk(dto.avatarUrl);
          if (!ok) throw new BadRequestException('AVATAR_URL_INVALID');
          patch.avatarUrl = ok;
        }
      }
      const [u] = await this.db
        .update(users)
        .set(emailChanged ? { ...patch, tokenVersion: sql`token_version + 1` } : patch)
        .where(eq(users.id, userId))
        .returning();
      if (!u) throw Err.unauthorized('USER_GONE');
      if (emailChanged) {
        await this.audit.record({
          actorId: userId,
          actorEmail: email,
          action: 'user.email.change',
          targetType: 'user',
          targetId: userId,
          meta: { from: existing.email },
        });
      }
      return this.strip(u);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw Err.conflict('EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw e;
    }
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto, ctx: { ip: string; userAgent?: string }) {
    if (dto.next !== dto.confirm) throw new BadRequestException('PASSWORDS_MISMATCH');

    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u?.passwordHash) {
      await this.audit.record({
        actorId: userId,
        actorEmail: u?.email,
        action: 'user.password.fail',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
      });
      throw new BadRequestException('PASSWORD_NOT_SET');
    }
    if (!(await verifyPassword(dto.current, u.passwordHash))) {
      await this.audit.record({
        actorId: userId,
        actorEmail: u?.email,
        action: 'user.password.fail',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
      });
      throw new BadRequestException('WRONG_CURRENT_PASSWORD');
    }
    if (dto.current === dto.next) throw new BadRequestException('PASSWORD_UNCHANGED');

    await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(dto.next),
        passwordChangedAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
        failedSince: null,
      })
      .where(eq(users.id, userId));

    // every existing session dies immediately: refresh rows are deleted AND
    // the token generation is bumped (outstanding access tokens fail guard).
    const revoked = await this.auth.revokeAllForUser(userId);
    await this.audit.record({
      actorId: userId,
      actorEmail: u.email,
      action: 'user.password.change',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      meta: { revokedSessions: revoked },
    });
    return { ok: true, revokedSessions: revoked };
  }

  /**
   * First password for OAuth-only accounts (passwordHash IS NULL). Requires a
   * live authenticated session — that IS the proof of ownership here. Once
   * set, the normal password flows (change, email change, delete) apply.
   */
  async setPassword(userId: string, dto: SetPasswordDto, ctx: { ip: string; userAgent?: string }) {
    if (dto.next !== dto.confirm) throw new BadRequestException('PASSWORDS_MISMATCH');
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Err.unauthorized('USER_GONE');
    if (u.passwordHash) throw Err.conflict('PASSWORD_ALREADY_SET', 'A password is already set — use password change instead');
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(dto.next), passwordChangedAt: new Date() })
      .where(eq(users.id, userId));
    await this.audit.record({
      actorId: userId,
      actorEmail: u.email,
      action: 'user.password.set',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
    });
    return { ok: true };
  }

  async updateNotifications(userId: string, dto: UpdateNotificationsDto) {
    const patch: Record<string, boolean> = {};
    if (dto.restarts !== undefined) patch.notifyRestarts = dto.restarts;
    if (dto.invoices !== undefined) patch.notifyInvoices = dto.invoices;
    if (dto.marketing !== undefined) patch.notifyMarketing = dto.marketing;
    if (!Object.keys(patch).length) return { ok: true };
    const [u] = await this.db.update(users).set(patch).where(eq(users.id, userId)).returning();
    if (!u) throw Err.unauthorized('USER_GONE');
    return {
      notifyRestarts: u.notifyRestarts,
      notifyInvoices: u.notifyInvoices,
      notifyMarketing: u.notifyMarketing,
    };
  }

  /**
   * One-click marketing unsubscribe from an emailed link. Verified purely by
   * the HMAC token (no login): it can ONLY flip marketing mail off — never
   * verification, reset, or security mail, and never anything else.
   */
  async unsubscribeMarketing(token: string, ctx: { ip: string; userAgent?: string }): Promise<{ ok: boolean; already: boolean }> {
    const uid = verifyUnsubscribe(token, config.JWT_ACCESS_SECRET);
    if (!uid) throw Err.invalid('UNSUBSCRIBE_INVALID', 'This unsubscribe link is invalid or expired');
    const [u] = await this.db.select({ id: users.id, email: users.email, notifyMarketing: users.notifyMarketing }).from(users).where(eq(users.id, uid)).limit(1);
    if (!u) throw Err.invalid('UNSUBSCRIBE_INVALID', 'This unsubscribe link is invalid or expired');
    if (!u.notifyMarketing) return { ok: true, already: true };
    await this.db.update(users).set({ notifyMarketing: false }).where(eq(users.id, uid));
    await this.audit
      .record({ actorId: uid, actorEmail: u.email, action: 'user.marketing.unsubscribe', targetType: 'user', targetId: uid, ip: ctx.ip, userAgent: ctx.userAgent })
      .catch(() => undefined);
    return { ok: true, already: false };
  }

  /**
   * Full account deletion: destroy every sandbox first (a DB cascade would
   * otherwise orphan live containers/networks/volumes), then remove the row.
   * Requires the current password: a transient stolen token must never be
   * enough for the most destructive action.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto, ctx: { ip: string; userAgent?: string }) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Err.unauthorized('USER_GONE');
    if (!u.passwordHash) throw new BadRequestException('PASSWORD_NOT_SET');
    if (!(await verifyPassword(dto.current, u.passwordHash))) {
      await this.audit.record({
        actorId: userId,
        actorEmail: u.email,
        action: 'user.delete.fail',
        targetType: 'user',
        targetId: userId,
        ip: ctx.ip,
      });
      throw new BadRequestException('WRONG_CURRENT_PASSWORD');
    }

    // 1. stop & remove docker resources of every owned server
    const destroyed = await this.servers.purgeAllForUser(userId);
    // 2. revoke refresh sessions (also cascades login history)
    const revoked = await this.auth.revokeAllForUser(userId);
    // 3. audit BEFORE the row disappears: actor_id has ON DELETE SET NULL,
    //    so recording after the delete violates the FK and is lost. Email
    //    is preserved in actorEmail for forensics.
    await this.audit.record({
      actorId: userId,
      actorEmail: u.email,
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      meta: { revokedSessions: revoked, destroyedServers: destroyed },
    });
    // 4. delete the account → cascades servers/backups/events rows
    await this.db.delete(users).where(eq(users.id, userId));

    this.log.log(`account ${u.email} deleted (${destroyed} sandboxes destroyed)`);
    return { ok: true };
  }

  // ---- Avatar management ------------------------------------------------------

  /**
   * Set a custom avatar (uploaded by user). Replaces any OAuth avatar.
   */
  async setCustomAvatar(userId: string, avatarUrl: string, ctx: { ip: string; userAgent?: string }) {
    const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw Err.unauthorized('USER_GONE');

    // Update avatar URL and mark as custom
    const [updated] = await this.db
      .update(users)
      .set({ avatarUrl, avatarSource: 'custom' })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) throw Err.unauthorized('USER_GONE');

    await this.audit.record({
      actorId: userId,
      actorEmail: existing.email,
      action: 'user.avatar.custom_set',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return this.strip({ ...updated[0], avatarUrl: updated[0].avatarUrl, avatarSource: 'custom' });
  }

  /**
   * Remove custom avatar, revert to OAuth avatar if available, otherwise default
   */
  async removeCustomAvatar(userId: string, ctx: { ip: string; userAgent?: string }) {
    const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw Err.unauthorized('USER_GONE');

    // Check if there's an OAuth avatar to fall back to
    const [oauthAccount] = await this.db
      .select({ avatarUrl: oauthAccounts.avatarUrl, provider: oauthAccounts.provider })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .limit(1);

    const fallbackAvatar = oauthAccount?.avatarUrl ?? null;
    const fallbackSource = oauthAccount ? 'oauth' : 'default';

    const [updated] = await this.db
      .update(users)
      .set({ avatarUrl: fallbackAvatar, avatarSource: fallbackSource })
      .where(eq(users.id, userId))
      .returning();

    if (!updated[0]) throw Err.unauthorized('USER_GONE');

    await this.audit.record({
      actorId: userId,
      actorEmail: existing.email,
      action: 'user.avatar.removed',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return this.strip({ ...updated[0], avatarUrl: updated[0].avatarUrl, avatarSource: fallbackSource });
  }

  /**
   * Set OAuth avatar (called when user logs in with OAuth)
   * Only sets avatar if current avatar is from OAuth or default
   */
  async setOAuthAvatar(userId: string, provider: 'google' | 'discord', avatarUrl: string) {
    const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) return;

    // Only set OAuth avatar if current avatar is from OAuth or default
    if (existing.avatarSource === 'oauth' || existing.avatarSource === 'default') {
      await this.db
        .update(users)
        .set({ avatarUrl, avatarSource: 'oauth' })
        .where(eq(users.id, userId))
        .catch(() => undefined);
    }
  }

  /**
   * Get avatar info for a user
   */
  async getAvatarInfo(userId: string) {
    const [user] = await this.db
      .select({
        avatarUrl: users.avatarUrl,
        avatarSource: users.avatarSource,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw Err.unauthorized('USER_GONE');

    return {
      avatarUrl: user.avatarUrl,
      avatarSource: user.avatarSource,
    };
  }

  /**
   * Set OAuth avatar on login (called from OAuth callback)
   */
  async setOAuthAvatarOnLogin(userId: string, provider: 'google' | 'discord', avatarUrl: string) {
    const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) return;

    // Only set OAuth avatar if current avatar is from OAuth or default
    if (existing.avatarSource === 'oauth' || existing.avatarSource === 'default') {
      await this.db
        .update(users)
        .set({ avatarUrl, avatarSource: 'oauth' })
        .where(eq(users.id, userId))
        .catch(() => undefined);
    }
  }
}