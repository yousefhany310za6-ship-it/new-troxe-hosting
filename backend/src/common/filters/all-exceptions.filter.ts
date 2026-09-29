import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { config } from '../../config/env';

const PG_CODE_MAP: Record<string, { status: number; code: string }> = {
  '23505': { status: 409, code: 'CONFLICT' }, // unique_violation
  '23503': { status: 409, code: 'REFERENCE_INVALID' }, // foreign_key_violation
  '23514': { status: 400, code: 'CONSTRAINT_VIOLATED' }, // check_violation
  '22P02': { status: 404, code: 'NOT_FOUND' }, // invalid uuid / text representation
  '22001': { status: 400, code: 'VALUE_TOO_LONG' },
  '40001': { status: 503, code: 'RETRY_TRANSACTION' },
  '57014': { status: 504, code: 'STATEMENT_TIMEOUT' },
  '53300': { status: 503, code: 'DB_OVERLOADED' },
};

/**
 * Single place where every error becomes a safe, predictable JSON body.
 * - never leaks stack traces or driver internals to clients
 * - always carries a requestId so client reports can be correlated with logs
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string; user?: unknown }>();
    const requestId = req.requestId ?? '-';
    const path = `${req.method} ${req.originalUrl}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = exception.name === 'ForbiddenException' ? 'FORBIDDEN' : 'ERROR';
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        code = typeof b.code === 'string' ? b.code : 'ERROR';
        if (Array.isArray(b.message)) {
          // class-validator output
          code = 'VALIDATION_ERROR';
          message = 'Validation failed';
          details = b.message;
        } else {
          message = typeof b.message === 'string' ? b.message : exception.message;
        }
      }
      // silent handling of noisy framework errors
      if (status === 404 && code === 'ERROR') code = 'NOT_FOUND';
    } else {
      const anyErr = exception as { code?: string; message?: string; stack?: string };
      const mapped = typeof anyErr?.code === 'string' ? PG_CODE_MAP[anyErr.code] : undefined;
      if (mapped) {
        status = mapped.status;
        code = mapped.code;
        message =
          mapped.code === 'CONFLICT' ? 'Resource already exists' : 'Database request could not be completed';
      }
      this.log.error(
        `${path} → ${status} ${code} [${requestId}]\n${anyErr?.stack ?? String(exception)}`,
      );
    }

    if (res.headersSent) return;

    res.status(status).json({
      statusCode: status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
      path,
      timestamp: new Date().toISOString(),
      ...(config.IS_PROD ? {} : { hint: undefined }),
    });
  }
}
