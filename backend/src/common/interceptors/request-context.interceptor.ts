import { HttpException, CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Correlates logs with client reports:
 *  - honours a client supplied `x-request-id` (sanitised) or mints one
 *  - echoes it back on every response
 *  - logs method, path, status, duration — never bodies (they may hold secrets)
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const inbound = String(req.headers['x-request-id'] ?? '');
    const requestId = SAFE_ID.test(inbound) ? inbound : randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.logAccess(req, res.statusCode, started, requestId),
        // the global filter sets the real status afterwards, so read it from
        // the exception itself — otherwise every failure would be logged 2xx
        error: (err) =>
          this.logAccess(
            req,
            err instanceof HttpException ? err.getStatus() : res.statusCode || 500,
            started,
            requestId,
          ),
      }),
    );
  }

  private logAccess(req: Request, status: number, started: number, requestId: string) {
    const ms = Date.now() - started;
    const line = `${status} ${req.method} ${req.originalUrl} ${ms}ms [${requestId}]`;
    if (status >= 500) this.log.error(line);
    else if (status >= 400) this.log.warn(line);
    else this.log.log(line);
  }
}
