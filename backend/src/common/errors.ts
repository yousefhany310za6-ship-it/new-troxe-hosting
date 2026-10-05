import { HttpException } from '@nestjs/common';

/**
 * Application-level error with a stable machine readable `code`.
 * The API contract is: `{ statusCode, code, message, requestId }`.
 */
export class AppError extends HttpException {
  /** Extra structured fields merged into the error response body. */
  meta?: Record<string, unknown>;

  constructor(code: string, status = 400, message?: string) {
    super({ statusCode: status, code, message: message ?? code }, status);
  }

  /** Attach structured details (e.g. nextChangeAt) to the error response. */
  withMeta(meta: Record<string, unknown>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }
}

/**
 * Find a Postgres error code on an exception or anywhere down its `cause`
 * chain (drizzle ≥0.44 wraps driver errors). Cycle-safe.
 */
export function pgCodeOf(exception: unknown): string | undefined {
  let cur: unknown = exception;
  const seen = new Set<unknown>();
  while (cur && (typeof cur === 'object' || typeof cur === 'function') && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export const Err = {
  invalidCredentials: () => new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password'),
  accountLocked: (seconds: number) =>
    new AppError('ACCOUNT_LOCKED', 429, `Too many failed attempts. Try again in ${seconds}s`),
  unauthorized: (code = 'UNAUTHORIZED') => new AppError(code, 401),
  forbidden: (code = 'FORBIDDEN') => new AppError(code, 403),
  notFound: (code = 'NOT_FOUND') => new AppError(code, 404),
  conflict: (code: string, message?: string) => new AppError(code, 409, message),
  tooMany: (code = 'RATE_LIMITED') => new AppError(code, 429),
  quota: (code: string, message: string) => new AppError(code, 402, message),
  invalid: (code: string, message?: string) => new AppError(code, 400, message),
  unavailable: (code: string, message?: string) => new AppError(code, 503, message),
};
