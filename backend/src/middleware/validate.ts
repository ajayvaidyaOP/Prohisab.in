import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { errors } from '../lib/errors.ts';

type Source = 'body' | 'query' | 'params';

/** Validates and replaces the selected request part with the parsed (typed, trimmed) value. */
export function validate<T>(schema: ZodType<T>, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(
        errors.badRequest(
          'Please correct the highlighted fields.',
          result.error.issues.map((issue) => ({
            field: issue.path.join('.') || undefined,
            message: issue.message,
          })),
        ),
      );
      return;
    }
    if (source === 'query') {
      // Express 5 exposes query as a getter; store the parsed value on a dedicated field instead.
      (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    } else {
      (req as unknown as Record<Source, T>)[source] = result.data;
    }
    next();
  };
}

export function getQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery as T;
}
