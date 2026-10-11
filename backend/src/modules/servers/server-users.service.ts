import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { Err } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { auditLogs, serverEvents, serverUsers, users } from '../../db/schema';
import { MAX_SUBUSERS, normalizePermissions } from './server-access-policy';
import { ServersService } from './servers.service';

/**
 * Server sharing. Only the owner manages the list (listing included — a
 * subuser never learns who else has access). Every change is audit-logged and
 * journaled as a server event, so the trail shows who was given what, when,
 * and by whom.
 *
 * Removal takes effect on the very next request: permissions are read from
 * this table on every call (see ServerAccessService), and open sockets are
 * dropped here for the removed user on the exec + support gateways? No —
 * exec sessions are looked up per event through the same service, so a
 * removed subuser's next subscribe/send is refused even on a live socket.
 */
@Injectable()
export class ServerUsersService {
  private readonly log = new Logger(ServerUsersService.name);

  constructor(
    @Inject(DB) private db: Db,
    private servers: ServersService,
  ) {}

  private async requireOwner(serverId: string, callerId: string) {
    const row = await this.servers.requireOwned(callerId, serverId);
    if (row.ownerId !== callerId) throw Err.forbidden('OWNER_REQUIRED');
    return row;
  }

  async list(serverId: string, callerId: string) {
    await this.requireOwner(serverId, callerId);
    const rows = await this.db
      .select({
        userId: serverUsers.userId,
        permissions: serverUsers.permissions,
        createdAt: serverUsers.createdAt,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        status: users.status,
      })
      .from(serverUsers)
      .innerJoin(users, eq(users.id, serverUsers.userId))
      .where(eq(serverUsers.serverId, serverId))
      .orderBy(serverUsers.createdAt);
    return rows;
  }

  async add(serverId: string, callerId: string, email: string, permissions: unknown, ctx: ReqCtx) {
    const row = await this.requireOwner(serverId, callerId);
    const address = email.trim().toLowerCase();
    const [target] = await this.db
      .select({ id: users.id, status: users.status, role: users.role })
      .from(users)
      .where(eq(users.email, address))
      .limit(1);
    // One neutral answer for every failure mode: the endpoint must not become
    // an oracle for which emails have accounts.
    if (!target || target.status !== 'active') throw Err.notFound('USER_NOT_FOUND');
    if (target.id === row.ownerId) throw Err.invalid('ALREADY_OWNER', 'That account already owns this server.');
    if (target.role === 'admin') throw Err.invalid('ADMIN_NO_GRANT', 'Administrators already have access — no grant needed.');
    const perms = normalizePermissions(permissions);
    if (!perms.length) throw Err.invalid('PERMISSIONS_EMPTY', 'Grant at least one permission.');
    // Viewing is part of every grant: acting on a server you cannot see is
    // meaningless, and seeing alone authorises nothing writable.
    if (!perms.includes('server.view')) perms.unshift('server.view');
    const [{ n }] = await this.db.select({ n: count() }).from(serverUsers).where(eq(serverUsers.serverId, serverId));
    if (n >= MAX_SUBUSERS) throw Err.quota('QUOTA_SUBUSERS', `A server can be shared with at most ${MAX_SUBUSERS} people.`);
    try {
      await this.db.insert(serverUsers).values({
        serverId,
        userId: target.id,
        permissions: perms,
        createdBy: callerId,
      });
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') throw Err.conflict('ALREADY_SHARED', 'That account already has access.');
      throw e;
    }
    await this.journal(serverId, callerId, 'subuser_add', { userId: target.id, permissions: perms }, ctx);
    return { userId: target.id, permissions: perms };
  }

  async update(serverId: string, callerId: string, userId: string, permissions: unknown, ctx: ReqCtx) {
    await this.requireOwner(serverId, callerId);
    const perms = normalizePermissions(permissions);
    if (!perms.length) throw Err.invalid('PERMISSIONS_EMPTY', 'Grant at least one permission (or remove the person instead).');
    if (!perms.includes('server.view')) perms.unshift('server.view');
    const [updated] = await this.db
      .update(serverUsers)
      .set({ permissions: perms })
      .where(and(eq(serverUsers.serverId, serverId), eq(serverUsers.userId, userId)))
      .returning({ userId: serverUsers.userId });
    if (!updated) throw Err.notFound('SUBUSER_NOT_FOUND');
    await this.journal(serverId, callerId, 'subuser_update', { userId, permissions: perms }, ctx);
    return { userId, permissions: perms };
  }

  async remove(serverId: string, callerId: string, userId: string, ctx: ReqCtx) {
    await this.requireOwner(serverId, callerId);
    const [deleted] = await this.db
      .delete(serverUsers)
      .where(and(eq(serverUsers.serverId, serverId), eq(serverUsers.userId, userId)))
      .returning({ userId: serverUsers.userId });
    if (!deleted) throw Err.notFound('SUBUSER_NOT_FOUND');
    await this.journal(serverId, callerId, 'subuser_remove', { userId }, ctx);
    return { ok: true };
  }

  private async journal(
    serverId: string,
    actorId: string,
    action: string,
    meta: Record<string, unknown>,
    ctx: ReqCtx,
  ) {
    await this.db.insert(serverEvents).values({ serverId, actorId, type: action, detail: meta }).catch(() => undefined);
    await this.db
      .insert(auditLogs)
      .values({
        actorId,
        action: `server.users.${action.replace('subuser_', '')}`,
        targetType: 'server',
        targetId: serverId,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta,
      } as never)
      .catch(() => undefined);
    this.log.log(`server ${serverId}: ${action} by ${actorId}`);
  }
}
