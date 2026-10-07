import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import { DB, Db } from '../../db/db.module';
import { users } from '../../db/schema';

export interface ReqUser {
  sub: string;
  sid: string;
  email: string;
  role: 'user' | 'admin';
}

/**
 * Validates the short-lived access token (Bearer header).
 *  - dedicated secret (never the refresh one)
 *  - `typ: 'access'` claim required so a refresh token can never be replayed
 *    as an access token even if someone mixes the secrets up
 */
/**
 * Validates the short-lived access token (Bearer header).
 *  - dedicated secret (never the refresh one)
 *  - `typ: 'access'` claim required so a refresh token can never be replayed
 *    as an access token even if someone mixes the secrets up
 *  - `v` (token version) must match the account: any explicit revocation
 *    (password change, logout, logout-all) instantly kills outstanding
 *    access tokens; intact refresh sessions transparently re-issue.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    @Inject(DB) private db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token || token.length > 4096) throw Err.unauthorized();

    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: config.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
      if (payload?.typ !== 'access' || typeof payload.sub !== 'string') throw new Error('bad typ');
      // single indexed PK lookup: revocation + deleted-account containment.
      const [u] = await this.db
        .select({ id: users.id, tokenVersion: users.tokenVersion, status: users.status })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (!u || u.status === 'deleted') throw new Error('user gone');
      // suspended users keep no API access: distinct 403 code (not 401) so
      // clients show the suspension screen instead of "session expired"
      if (u.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403, 'Your account has been suspended by the administration.');
      if (typeof payload.v !== 'number' || payload.v !== u.tokenVersion) throw new Error('revoked');
      req.user = {
        sub: payload.sub,
        sid: payload.sid ?? '',
        email: payload.email,
        role: payload.role === 'admin' ? 'admin' : 'user',
      } satisfies ReqUser;
      return true;
    } catch {
      throw Err.unauthorized('INVALID_TOKEN');
    }
  }
}
