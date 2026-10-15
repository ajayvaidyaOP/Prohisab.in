import { Prisma } from '../generated/prisma/client.ts';

/**
 * Money helpers.
 *
 * - Database columns are MySQL DECIMAL(15,2).
 * - Arithmetic uses Prisma.Decimal (decimal.js, arbitrary-precision decimal) – never JS floats.
 * - API responses carry money as fixed 2-decimal strings, e.g. "1234.50".
 */
export type Money = Prisma.Decimal;

export const MONEY_SCALE = 2;
export const MAX_MONEY_STRING = '9999999999999.99'; // DECIMAL(15,2) upper bound

const MONEY_INPUT_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

export const ZERO: Money = new Prisma.Decimal(0);

export type DecimalInput = string | number | Prisma.Decimal;

export function money(value: DecimalInput): Money {
  return new Prisma.Decimal(value);
}

/** Serialize a Decimal for the API: always exactly two decimals, no exponent. */
export function formatMoney(value: Money | string | number): string {
  return new Prisma.Decimal(value).toFixed(MONEY_SCALE);
}

/**
 * Parse money coming from a client. Accepts a string or finite number with at most 2 decimals.
 * Returns the canonical string form. Throws a plain Error with a user-facing message on failure.
 */
export function parseMoneyInput(raw: unknown, field = 'amount'): string {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new Error(`${field} must be a valid number.`);
    text = raw.toString();
    if (/e/i.test(text)) throw new Error(`${field} must be a plain decimal number with at most 2 decimals.`);
  } else if (typeof raw === 'string') {
    text = raw.trim().replace(/,/g, '');
  } else {
    throw new Error(`${field} is required.`);
  }
  if (!MONEY_INPUT_PATTERN.test(text)) {
    throw new Error(`${field} must be a number with at most 2 decimal places.`);
  }
  const [intPart, fracPart = ''] = text.split('.');
  const normalized = `${intPart}.${fracPart.padEnd(MONEY_SCALE, '0')}`;
  if (new Prisma.Decimal(normalized).gt(MAX_MONEY_STRING)) {
    throw new Error(`${field} is too large.`);
  }
  return normalized;
}

export function isPositive(value: Money): boolean {
  return value.gt(0);
}

export function isNegative(value: Money): boolean {
  return value.lt(0);
}
