import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError, Err } from '../../common/errors';
import { DB, Db } from '../../db/db.module';
import { serverUsers, servers, users, type Server } from '../../db/schema';
import { normalizePermissions, type ServerPermission } from './server-access-policy';

export interface ServerAccess {
  row: Server;
  isOwner: boolean;
  /** effective permissions (owners carry every key implicitly) */
  permissions: string[];
}

/**
 * Who may touch a server. The owner always; anyone else needs a server_users
 * row. The role comes from the users table on every call, so a revoked
 * subuser (or a suspended account) loses access on the next request — never
 * when a token happens to expire.
 *
 * No access and unknown id are the same answer (404): knowing an id proves
 * nothing. A known-but-insufficient permission is an honest 403.
 */
@Injectable()
export class ServerAccessService {
  constructor(@Inject(DB) private db: Db) {}

  async resolve(serverId: string, userId: string): Promise<ServerAccess> {
    // Admin bypass used by internal admin paths (never a real session).
    if (userId === 'admin') {
      const [row] = await this.db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
      if (!row) throw Err.notFound('SERVER_NOT_FOUND');
      return { row, isOwner: true, permissions: [] };
    }
    const [row] = await this.db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!row) throw Err.notFound('SERVER_NOT_FOUND');
    if (row.ownerId === userId) return { row, isOwner: true, permissions: [] };
    const [grant] = await this.db
      .select({ permissions: serverUsers.permissions, status: users.status })
      .from(serverUsers)
      .innerJoin(users, eq(users.id, serverUsers.userId))
      .where(and(eq(serverUsers.serverId, serverId), eq(serverUsers.userId, userId)))
      .limit(1);
    if (!grant || grant.status !== 'active') throw Err.notFound('SERVER_NOT_FOUND');
    return { row, isOwner: false, permissions: normalizePermissions(grant.permissions) };
  }

  /** Throw unless the caller holds `required` (owners always pass). */
  requirePermission(access: ServerAccess, required: ServerPermission): void {
    if (access.isOwner) return;
    if (!access.permissions.includes(required)) {
      throw new AppError('PERMISSION_DENIED', 403, `This action needs the "${required}" permission.`);
    }
  }

  /** The caller's view of their own grant (for the UI: what may I do here?). */
  async myGrant(serverId: string, userId: string): Promise<{ isOwner: boolean; permissions: string[] }> {
    const access = await this.resolve(serverId, userId).catch(() => null);
    if (!access) return { isOwner: false, permissions: [] };
    return { isOwner: access.isOwner, permissions: access.permissions };
  }
}
