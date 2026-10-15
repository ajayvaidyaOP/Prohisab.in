import { z } from 'zod';
import { isoDateField } from '../../lib/schemas.ts';

export const ledgerQuery = z
  .object({
    from: isoDateField('From date').optional(),
    to: isoDateField('To date').optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'From date must be on or before To date.',
    path: ['from'],
  });

export const statementQuery = z
  .object({
    from: isoDateField('From date').optional(),
    to: isoDateField('To date').optional(),
    search: z.string().trim().max(100).optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'From date must be on or before To date.',
    path: ['from'],
  });

export type LedgerQuery = z.infer<typeof ledgerQuery>;
export type StatementQuery = z.infer<typeof statementQuery>;
