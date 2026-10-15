import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client.ts';
import { AppError, errors } from '../lib/errors.ts';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('X-Request-Id');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}.`));
}

type LedgerCause = { kind?: string; originalCode?: string; originalMessage?: string; state?: string };

/**
 * Database triggers raise SQLSTATE 45000 (MySQL error 1644) with a readable message.
 * Only those messages are shown to the user; every other database error stays generic.
 */
function ledgerSafeguardMessage(cause: LedgerCause | undefined): string | null {
  if (!cause || cause.kind === 'ConnectionError') return null;
  const isSafeguard = cause.state === '45000' || cause.originalCode === '1644';
  return isSafeguard && cause.originalMessage ? cause.originalMessage : null;
}

/** Maps MySQL/Prisma/driver errors to safe, consistent API errors. Internal details are logged only. */
function mapError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // Body parser errors (malformed JSON, payload too large)
  const httpLike = error as { type?: string; status?: number; statusCode?: number };
  if (httpLike?.type === 'entity.parse.failed') return errors.badRequest('The request body is not valid JSON.');
  if (httpLike?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return errors.conflict('DUPLICATE_RECORD', 'A record with the same unique value already exists.');
      case 'P2003':
        return errors.conflict('RELATED_RECORD_CONFLICT', 'This change conflicts with related records.');
      case 'P2025':
        return errors.notFound();
      case 'P2010':
      case 'P2039': {
        const cause = (error.meta as { driverAdapterError?: { cause?: LedgerCause } } | undefined)?.driverAdapterError?.cause;
        const ledgerMessage = ledgerSafeguardMessage(cause);
        if (ledgerMessage) return errors.unprocessable('LEDGER_RULE_VIOLATION', ledgerMessage);
        return errors.serviceUnavailable();
      }
      default:
        break;
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return errors.serviceUnavailable();
  }

  if (error instanceof Error && /ECONNREFUSED|ETIMEDOUT|Pool timeout|Connection .* closed|ER_CON_COUNT|Too many connections/i.test(error.message)) {
    return errors.serviceUnavailable();
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on the server. Please try again.');
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  const appError = mapError(error);
  if (appError.status >= 500) {
    // Log the full error server-side for diagnosis; never send it to the client.
    console.error(JSON.stringify({
      level: 'error',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
  }
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: req.requestId,
    },
  });
}
