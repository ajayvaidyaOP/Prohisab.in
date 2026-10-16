import { z } from 'zod';
import { isValidIsoDate, isoDateToDbDate } from './dates.ts';
import { errors } from './errors.ts';

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw errors.badRequest('Please correct the highlighted fields.', result.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      message: issue.message,
    })));
  }
  return result.data;
}

export function id(value: unknown, field = 'id'): bigint {
  const raw = String(value ?? '');
  if (!/^[1-9]\d{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw errors.badRequest(`Invalid ${field}.`, [{ field, message: 'Choose a valid record.' }]);
  }
  return BigInt(raw);
}

/** The API uses JS numbers for IDs; fail rather than silently rounding a database BIGINT. */
export function num(value: bigint | null | undefined): number | null {
  if (value == null) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('A database ID exceeds the safe JavaScript integer range.');
  return result;
}

export function textParam(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function paging(query: Record<string, unknown>, defaultSize = 20) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? defaultSize : Number(query.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw errors.badRequest('Invalid pagination. Page must be positive and pageSize must be 1–100.');
  }
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function dateParam(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !isValidIsoDate(raw.trim())) {
    throw errors.badRequest(`Invalid ${field} date. Use YYYY-MM-DD.`, [{ field, message: 'Enter a valid date.' }]);
  }
  return raw.trim();
}

export function dateRange(query: Record<string, unknown>) {
  const from = dateParam(query.from, 'from');
  const to = dateParam(query.to, 'to');
  if (from && to && from > to) throw errors.badRequest('From date must be on or before To date.');
  return {
    from,
    to,
    where: from || to ? { ...(from ? { gte: isoDateToDbDate(from) } : {}), ...(to ? { lte: isoDateToDbDate(to) } : {}) } : undefined,
  };
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function nullableString(raw: string | null | undefined): string | null {
  return raw?.trim() || null;
}
