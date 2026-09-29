import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { servers } from '../../db/schema';

@Injectable()
export class ServerOwnerGuard implements CanActivate {
  constructor(@Inject(DB) private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id: string = req.params?.id;
    const userId: string = req.user?.sub;
    if (!id || !userId) throw new ForbiddenException('FORBIDDEN');
    const rows = await this.db
      .select()
      .from(servers)
      .where(and(eq(servers.id, id), eq(servers.ownerId, userId)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('SERVER_NOT_FOUND');
    req.server = rows[0];
    return true;
  }
}
