import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ReqUser } from './jwt.guard';

/** Extracts the verified user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ReqUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as ReqUser;
  },
);
