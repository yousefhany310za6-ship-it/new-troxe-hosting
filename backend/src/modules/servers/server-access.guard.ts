import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Err } from '../../common/errors';
import type { ReqUser } from '../auth/jwt.guard';
import { ServerAccessService } from './server-access.service';

/**
 * Owner OR subuser gate. Unlike ServerOwnerGuard (owner-only, kept for
 * destructive routes), this passes anyone with a grant and stashes the
 * resolved access on the request — services still enforce the exact
 * permission per operation, so this gate alone grants nothing but passage.
 */
@Injectable()
export class ServerAccessGuard implements CanActivate {
  constructor(private access: ServerAccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id: string | undefined = req.params?.id;
    const user: ReqUser | undefined = req.user;
    if (!id || !user?.sub) throw Err.forbidden();
    const resolved = await this.access.resolve(id, user.sub);
    req.server = resolved.row;
    req.serverAccess = { isOwner: resolved.isOwner, permissions: resolved.permissions };
    return true;
  }
}
