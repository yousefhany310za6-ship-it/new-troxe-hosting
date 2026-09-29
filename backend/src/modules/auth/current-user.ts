import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type ReqUser = { sub: string; email: string; role: string };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ReqUser => ctx.switchToHttp().getRequest().user,
);
