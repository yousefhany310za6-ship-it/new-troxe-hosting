import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('UNAUTHORIZED');
    try {
      req.user = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev',
      });
      return true;
    } catch {
      throw new UnauthorizedException('INVALID_TOKEN');
    }
  }
}
