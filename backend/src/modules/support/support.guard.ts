import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Support-or-admin gate. Support staff get ticket/queue access through
 * dedicated endpoints — never admin routes (those keep AdminGuard).
 * Role comes from the verified JWT via JwtAuthGuard (must run first).
 */
@Injectable()
export class SupportGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('SUPPORT_REQUIRED');
    if (user.role !== 'support' && user.role !== 'admin') {
      throw new ForbiddenException('SUPPORT_REQUIRED');
    }
    return true;
  }
}
