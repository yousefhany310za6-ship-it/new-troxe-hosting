import { HttpException } from '@nestjs/common';

/**
 * Application-level error with a stable machine readable `code`.
 * The API contract is: `{ statusCode, code, message, requestId }`.
 */
export class AppError extends HttpException {
  constructor(code: string, status = 400, message?: string) {
    super({ statusCode: status, code, message: message ?? code }, status);
  }
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
