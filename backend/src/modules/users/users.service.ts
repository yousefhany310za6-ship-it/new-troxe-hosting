import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Err } from '../../common/errors';
import { hashPassword, verifyPassword } from '../../common/password';
import { DB, Db } from '../../db/db.module';
import { users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../auth/auth.service';
import { ServersService } from '../servers/servers.service';
import { UpdateNotificationsDto, UpdatePasswordDto, UpdateProfileDto, DeleteAccountDto } from './dto';

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

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const email = dto.email.toLowerCase().trim();
    const [existing] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw Err.unauthorized('USER_GONE');

    // an email change re-points recovery: it must be confirmed with the
    // password (a stolen short-lived token alone cannot persist a hijack).
    if (email !== existing.email) {
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
      const [u] = await this.db
        .update(users)
        .set({ name: dto.name.trim(), email })
        .where(eq(users.id, userId))
        .returning();
      if (!u) throw Err.unauthorized('USER_GONE');
      if (email !== existing.email) {
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
    if (!u || !(await verifyPassword(dto.current, u.passwordHash))) {
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
   * Full account deletion: destroy every sandbox first (a DB cascade would
   * otherwise orphan live containers/networks/volumes), then remove the row.
   * Requires the current password: a transient stolen token must never be
   * enough for the most destructive action.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto, ctx: { ip: string; userAgent?: string }) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw Err.unauthorized('USER_GONE');
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
}
