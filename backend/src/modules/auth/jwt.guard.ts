import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { config } from '../../config/env';
import { Err } from '../../common/errors';

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
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

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
