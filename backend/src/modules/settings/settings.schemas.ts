import { z } from 'zod';
import { isValidTimeZone } from '../../lib/dates.ts';
import { optionalText } from '../../lib/schemas.ts';

const emailField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') return null;
    if (!z.email().safeParse(trimmed).success) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.' });
      return z.NEVER;
    }
    return trimmed;
  });

export const settingsUpdateBody = z
  .object({
    businessName: z
      .string({ error: 'Business name is required.' })
      .trim()
      .min(2, 'Business name must be at least 2 characters.')
      .max(150, 'Business name must be 150 characters or fewer.'),
    businessAddress: optionalText(500, 'Business address'),
    businessPhone: optionalText(30, 'Business phone'),
    businessEmail: emailField,
    currencySymbol: z
      .string({ error: 'Currency symbol is required.' })
      .trim()
      .min(1, 'Currency symbol is required.')
      .max(8, 'Currency symbol must be 8 characters or fewer.'),
    timezone: z
      .string({ error: 'Time zone is required.' })
      .trim()
      .refine((value) => isValidTimeZone(value), 'Choose a valid IANA time zone, e.g. Asia/Kolkata.'),
  })
  .strict();

export const passwordChangeBody = z
  .object({
    currentPassword: z.string({ error: 'Enter your current password.' }).min(1, 'Enter your current password.').max(200),
    newPassword: z
      .string({ error: 'Enter a new password.' })
      .min(10, 'The new password must be at least 10 characters.')
      .max(200, 'The new password must be 200 characters or fewer.'),
  })
  .strict()
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'The new password must be different from the current password.',
    path: ['newPassword'],
  });

export type SettingsUpdateBody = z.infer<typeof settingsUpdateBody>;
export type PasswordChangeBody = z.infer<typeof passwordChangeBody>;
