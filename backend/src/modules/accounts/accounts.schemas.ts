import { z } from 'zod';
import { moneyField, optionalText } from '../../lib/schemas.ts';

const accountTypeField = z.enum(['CUSTOMER', 'SUPPLIER'], { error: 'Choose Customer or Supplier.' });

const phoneField = optionalText(30, 'Phone').transform((value, ctx) => {
  if (value && !/^[+0-9()\-\s]{6,30}$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'Phone may contain digits, spaces, +, - and parentheses only.' });
    return z.NEVER;
  }
  return value;
});

const emailField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') return null;
    if (trimmed.length > 190 || !z.email().safeParse(trimmed).success) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.' });
      return z.NEVER;
    }
    return trimmed;
  });

const nameField = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(150, 'Name must be 150 characters or fewer.');

const usernameField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') return undefined;
    if (trimmed.length < 2 || trimmed.length > 150) {
      ctx.addIssue({
        code: 'custom',
        message: 'Username must be between 2 and 150 characters.',
      });
      return z.NEVER;
    }
    return trimmed;
  });

const passwordField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    const raw = value ?? '';
    if (raw === '') return undefined;
    if (raw.length < 4 || raw.length > 200) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password must be at least 4 characters.',
      });
      return z.NEVER;
    }
    return raw;
  });

/** openingBalanceSide is optional on input; when provided it must match the account type's normal side (checked in the service). */
export const accountCreateBody = z
  .object({
    name: nameField,
    type: accountTypeField.optional().default('CUSTOMER'),
    username: usernameField,
    password: passwordField,
    phone: phoneField,
    email: emailField,
    address: optionalText(1000, 'Address'),
    openingBalance: moneyField({ label: 'Opening balance' }).optional().default('0.00'),
    openingBalanceSide: z.enum(['RECEIVABLE', 'PAYABLE']).optional(),
    notes: optionalText(2000, 'Notes'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.username && !value.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Enter a password for this user login.',
      });
    }
  });

export const accountUpdateBody = z
  .object({
    name: nameField.optional(),
    type: accountTypeField.optional(),
    username: usernameField,
    password: passwordField,
    phone: phoneField.optional(),
    email: emailField.optional(),
    address: optionalText(1000, 'Address').optional(),
    openingBalance: moneyField({ label: 'Opening balance' }).optional(),
    openingBalanceSide: z.enum(['RECEIVABLE', 'PAYABLE']).optional(),
    notes: optionalText(2000, 'Notes').optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

export const accountStatusBody = z.object({ isActive: z.boolean({ error: 'isActive must be true or false.' }) }).strict();

export const accountListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  type: accountTypeField.optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  sort: z.enum(['name', 'code', 'newest']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const accountOptionsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  type: accountTypeField.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export type AccountCreateBody = z.infer<typeof accountCreateBody>;
export type AccountUpdateBody = z.infer<typeof accountUpdateBody>;
export type AccountListQuery = z.infer<typeof accountListQuery>;
export type AccountOptionsQuery = z.infer<typeof accountOptionsQuery>;
