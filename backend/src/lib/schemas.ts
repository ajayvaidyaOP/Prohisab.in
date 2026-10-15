import { z } from 'zod';
import { parseMoneyInput } from './money.ts';
import { isValidIsoDate } from './dates.ts';

/** Money input: a non-negative/positive decimal string or number with at most 2 decimals. */
export function moneyField(options: { min?: 'zero' | 'positive'; label: string }) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    try {
      const normalized = parseMoneyInput(value, options.label);
      if (options.min === 'positive' && normalized === '0.00') {
        ctx.addIssue({ code: 'custom', message: `${options.label} must be greater than zero.` });
        return z.NEVER;
      }
      return normalized;
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  });
}

export const isoDateField = (label = 'Date') =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .refine((value) => isValidIsoDate(value), `${label} must be a real date in YYYY-MM-DD format.`);

/** Optional free text: empty string becomes null. */
export const optionalText = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value, ctx) => {
      const trimmed = value?.trim() ?? '';
      if (trimmed.length > max) {
        ctx.addIssue({ code: 'custom', message: `${label} must be ${max} characters or fewer.` });
        return z.NEVER;
      }
      return trimmed === '' ? null : trimmed;
    });

export const idParam = z.object({
  id: z.coerce.number({ error: 'Invalid id.' }).int().positive('Invalid id.'),
});
