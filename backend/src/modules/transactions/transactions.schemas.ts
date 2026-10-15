import { z } from 'zod';
import { moneyField, isoDateField, optionalText } from '../../lib/schemas.ts';
import { TransactionType } from '../../generated/prisma/client.ts';
import { TRANSACTION_RULES, USER_TRANSACTION_TYPES, isUserTransactionType } from '../ledger/ledger.rules.ts';

const paymentMethods = ['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;

export const createTransactionBody = z
  .object({
    accountId: z.coerce.number({ error: 'Choose an account.' }).int().positive('Choose an account.'),
    type: z.string({ error: 'Choose a transaction type.' }).refine(isUserTransactionType, {
      message: `Choose a valid transaction type (${USER_TRANSACTION_TYPES.join(', ')}).`,
    }),
    entryDate: isoDateField('Date'),
    amount: moneyField({ label: 'Amount', min: 'positive' }),
    paymentMethod: z.enum(paymentMethods, { error: 'Choose a payment method.' }).nullable().optional(),
    referenceNumber: optionalText(100, 'Reference number'),
    notes: optionalText(500, 'Notes'),
    // Optional echo of the posting rule. Accepted only if it matches the server rule for the type.
    side: z.enum(['RECEIVABLE', 'PAYABLE']).optional(),
    direction: z.enum(['INCREASE', 'DECREASE']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isUserTransactionType(value.type)) return;
    const rule = TRANSACTION_RULES[value.type];
    if (rule.requiresPaymentMethod && !value.paymentMethod) {
      ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Choose how the payment was made.' });
    }
  });

export const reverseBody = z
  .object({
    reason: z
      .string({ error: 'Please describe why this entry is being reversed.' })
      .trim()
      .min(3, 'Please describe why this entry is being reversed (at least 3 characters).')
      .max(300, 'Reason must be 300 characters or fewer.'),
    entryDate: isoDateField('Reversal date').optional(),
  })
  .strict();

export const transactionsQuery = z
  .object({
    search: z.string().trim().max(100).optional(),
    type: z.enum(TransactionType).optional(),
    accountId: z.coerce.number().int().positive().optional(),
    from: isoDateField('From date').optional(),
    to: isoDateField('To date').optional(),
    includeReversals: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'From date must be on or before To date.',
    path: ['from'],
  });

export type CreateTransactionBody = z.infer<typeof createTransactionBody>;
export type ReverseBody = z.infer<typeof reverseBody>;
export type TransactionsQuery = z.infer<typeof transactionsQuery>;
