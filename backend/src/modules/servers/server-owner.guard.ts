import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { servers } from '../../db/schema';
import { Err } from '../../common/errors';
import type { ReqUser } from '../auth/jwt.guard';

/**
 * Loads `req.server` only when the row belongs to the authenticated user.
 * Both predicates are applied in a single query — an id alone is never enough.
 */
@Injectable()
export class ServerOwnerGuard implements CanActivate {
  constructor(@Inject(DB) private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id: string | undefined = req.params?.id;
    const user: ReqUser | undefined = req.user;
    if (!id || !user?.sub) throw Err.forbidden();

    const rows = await this.db
      .select()
      .from(servers)
      .where(and(eq(servers.id, id), eq(servers.ownerId, user.sub)))
      .limit(1);

    if (!rows.length) throw Err.notFound('SERVER_NOT_FOUND');
    req.server = rows[0];
    return true;
  }
}
