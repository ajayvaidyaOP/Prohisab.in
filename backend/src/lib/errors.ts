/**
 * Application error with an HTTP status and a stable, machine-readable code.
 * Messages are safe to show to the user; internal details are logged, never returned.
 */
export type ErrorDetail = { field?: string; message: string };

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (message: string, details?: ErrorDetail[]) => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'The requested record was not found.') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code: string, message: string, details?: ErrorDetail[]) => new AppError(409, code, message, details),
  unprocessable: (code: string, message: string, details?: ErrorDetail[]) => new AppError(422, code, message, details),
  tooManyRequests: (message = 'Too many requests. Please wait a few minutes and try again.') =>
    new AppError(429, 'RATE_LIMITED', message),
  serviceUnavailable: (message = 'The database is currently unavailable. Please try again shortly.') =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};
