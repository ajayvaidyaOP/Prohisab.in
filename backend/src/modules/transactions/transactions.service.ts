import { Prisma } from '../../generated/prisma/client.ts';
import type { PaymentMethod, TransactionType } from '../../generated/prisma/client.ts';
import { prisma, type Tx } from '../../db/prisma.ts';
import { errors } from '../../lib/errors.ts';
import { writeAudit } from '../../lib/audit.ts';
import { withIdempotency, type IdempotentResult } from '../../lib/idempotency.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { dbDateToIso, isoDateToDbDate, todayInTimeZone } from '../../lib/dates.ts';
import { getSettings, DEFAULT_USER_ENTRY_OPTIONS } from '../settings/settings.service.ts';
import { lockAccount } from '../accounts/accounts.service.ts';
import { ACCOUNT_TYPE_LABELS, serializeAccount } from '../accounts/accounts.serializers.ts';
import { loadBalances } from '../ledger/ledger.queries.ts';
import { PAYMENT_METHOD_LABELS, TRANSACTION_RULES, TYPE_LABELS, isUserTransactionType } from '../ledger/ledger.rules.ts';
import type { CreateTransactionBody, RejectBody, ReverseBody, TransactionsQuery } from './transactions.schemas.ts';

const entryInclude = {
  account: { select: { id: true, accountCode: true, name: true, type: true } },
  reversedBy: { select: { id: true } },
  reviewedBy: { select: { id: true, username: true } },
} satisfies Prisma.LedgerEntryInclude;

type EntryWithRelations = Prisma.LedgerEntryGetPayload<{ include: typeof entryInclude }>;

export function serializeTransaction(entry: EntryWithRelations) {
  return {
    id: entry.id,
    entryDate: dbDateToIso(entry.entryDate),
    type: entry.type,
    typeLabel: TYPE_LABELS[entry.type],
    side: entry.side,
    direction: entry.direction,
    amount: formatMoney(entry.amount),
    paymentMethod: entry.paymentMethod,
    paymentMethodLabel: entry.paymentMethod ? PAYMENT_METHOD_LABELS[entry.paymentMethod] : null,
    referenceNumber: entry.referenceNumber,
    notes: entry.notes,
    reversalOfId: entry.reversalOfId,
    reversedById: entry.reversedBy?.id ?? null,
    isReversal: entry.type === 'REVERSAL',
    isReversed: entry.reversedBy !== null,
    approvalStatus: entry.approvalStatus,
    reviewedBy: entry.reviewedBy ? { id: entry.reviewedBy.id, username: entry.reviewedBy.username } : null,
    reviewedAt: entry.reviewedAt ? entry.reviewedAt.toISOString() : null,
    rejectionReason: entry.rejectionReason,
    account: {
      id: entry.account.id,
      accountCode: entry.account.accountCode,
      name: entry.account.name,
      type: entry.account.type,
      typeLabel: ACCOUNT_TYPE_LABELS[entry.account.type],
    },
    createdById: entry.createdById,
    createdAt: entry.createdAt.toISOString(),
  };
}

async function accountSummary(tx: Tx, accountId: number) {
  const account = await tx.account.findUniqueOrThrow({
    where: { id: accountId },
    include: { loginUser: { select: { username: true } } },
  });
  const info = await loadBalances(tx, [accountId]);
  return serializeAccount(account, info.get(accountId));
}

function assertNotFuture(entryDate: string, today: string): void {
  if (entryDate > today) {
    throw errors.unprocessable('FUTURE_DATE', `The date cannot be in the future (today is ${today}).`, [
      { field: 'entryDate', message: 'Choose today or an earlier date.' },
    ]);
  }
}

/** Posts a transaction. The side and direction come from the server rule for the type, never from the client. */
export async function postTransaction(
  tx: Tx,
  input: CreateTransactionBody,
  actorId: number,
  today: string,
  actorRole: 'ADMIN' | 'USER' = 'ADMIN',
) {
  if (!isUserTransactionType(input.type)) throw errors.badRequest('Choose a valid transaction type.');
  const rule = TRANSACTION_RULES[input.type];

  assertNotFuture(input.entryDate, today);

  const account = await lockAccount(tx, input.accountId);
  if (!account.isActive) {
    throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before recording transactions.', [
      { field: 'accountId', message: 'Account is inactive.' },
    ]);
  }
  if (account.type !== rule.accountType) {
    throw errors.unprocessable(
      'TRANSACTION_TYPE_MISMATCH',
      `“${TYPE_LABELS[input.type as Exclude<TransactionType, 'REVERSAL'>]}” applies to ${rule.accountType.toLowerCase()} accounts only.`,
      [{ field: 'type', message: `Choose a ${rule.accountType.toLowerCase()} account or a different type.` }],
    );
  }
  if ((input.side && input.side !== rule.side) || (input.direction && input.direction !== rule.direction)) {
    throw errors.unprocessable(
      'POSTING_RULE_MISMATCH',
      'The side or direction does not match the rule for this transaction type. The server sets these automatically.',
    );
  }

  const approvalStatus = actorRole === 'USER' ? 'PENDING' : 'APPROVED';
  const entry = await tx.ledgerEntry.create({
    data: {
      accountId: input.accountId,
      entryDate: isoDateToDbDate(input.entryDate),
      type: input.type as TransactionType,
      side: rule.side,
      direction: rule.direction,
      amount: money(input.amount).toFixed(2),
      paymentMethod: (input.paymentMethod ?? null) as PaymentMethod | null,
      referenceNumber: input.referenceNumber,
      notes: input.notes,
      approvalStatus,
      reviewedById: approvalStatus === 'APPROVED' ? actorId : null,
      reviewedAt: approvalStatus === 'APPROVED' ? new Date() : null,
      createdById: actorId,
    },
    include: entryInclude,
  });

  await writeAudit(tx, {
    action: 'LEDGER_ENTRY_CREATED',
    entityType: 'LedgerEntry',
    entityId: entry.id,
    actorId,
    details: {
      accountId: entry.accountId,
      type: entry.type,
      side: entry.side,
      direction: entry.direction,
      amount: formatMoney(entry.amount),
      entryDate: input.entryDate,
      paymentMethod: entry.paymentMethod,
      referenceNumber: entry.referenceNumber,
      approvalStatus,
    },
  });

  return { entry, account: await accountSummary(tx, input.accountId) };
}

export async function createTransaction(
  input: CreateTransactionBody,
  actorId: number,
  key: string,
  actorRole: 'ADMIN' | 'USER' = 'ADMIN',
): Promise<IdempotentResult & { replayed: boolean }> {
  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);
  if (actorRole === 'USER') {
    const allowedOptions = Array.isArray(settings.userEntryOptions) && settings.userEntryOptions.length > 0
      ? (settings.userEntryOptions as string[])
      : DEFAULT_USER_ENTRY_OPTIONS;
    const noteText = (input.notes ?? '').trim();
    const matchesAllowed = allowedOptions.some(
      (opt) =>
        typeof opt === 'string' &&
        (noteText.toLowerCase() === opt.trim().toLowerCase() ||
          noteText.toLowerCase().startsWith(`${opt.trim().toLowerCase()} —`) ||
          noteText.toLowerCase().startsWith(`${opt.trim().toLowerCase()} -`)),
    );
    if (!matchesAllowed) {
      throw errors.unprocessable(
        'INVALID_USER_OPTION',
        'Please select a valid option configured by the Administrator.',
        [{ field: 'notes', message: 'Select an option from the list set by Admin.' }],
      );
    }
  }
  return withIdempotency({
    scope: 'POST /api/transactions',
    key,
    payload: { ...input, actorRole },
    work: async (tx) => {
      const { entry, account } = await postTransaction(tx, input, actorId, today, actorRole);
      return { status: 201, body: { transaction: serializeTransaction(entry), account } };
    },
  });
}

export async function approveTransaction(entryId: number, actorId: number, key: string) {
  return withIdempotency({
    scope: `POST /api/transactions/${entryId}/approve`,
    key,
    payload: { entryId },
    work: async (tx) => {
      const initial = await tx.ledgerEntry.findUnique({ where: { id: entryId }, include: entryInclude });
      if (!initial) throw errors.notFound('Transaction not found.');

      const account = await lockAccount(tx, initial.accountId);
      if (!account.isActive) {
        throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before approving entries.');
      }

      const entry = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId }, include: entryInclude });
      if (entry.approvalStatus === 'APPROVED') {
        return {
          status: 200,
          body: {
            transaction: serializeTransaction(entry),
            account: await accountSummary(tx, entry.accountId),
            alreadyApproved: true,
          },
        };
      }
      if (entry.approvalStatus === 'REJECTED') {
        throw errors.conflict('ALREADY_REJECTED', 'This entry has already been rejected and cannot be approved.');
      }

      const updated = await tx.ledgerEntry.update({
        where: { id: entryId },
        data: {
          approvalStatus: 'APPROVED',
          reviewedById: actorId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        include: entryInclude,
      });

      await writeAudit(tx, {
        action: 'LEDGER_ENTRY_APPROVED',
        entityType: 'LedgerEntry',
        entityId: updated.id,
        actorId,
        details: {
          accountId: updated.accountId,
          type: updated.type,
          amount: formatMoney(updated.amount),
          entryDate: dbDateToIso(updated.entryDate),
        },
      });

      return {
        status: 200,
        body: {
          transaction: serializeTransaction(updated),
          account: await accountSummary(tx, updated.accountId),
        },
      };
    },
  });
}

export async function rejectTransaction(entryId: number, input: RejectBody, actorId: number, key: string) {
  return withIdempotency({
    scope: `POST /api/transactions/${entryId}/reject`,
    key,
    payload: { entryId, ...input },
    work: async (tx) => {
      const initial = await tx.ledgerEntry.findUnique({ where: { id: entryId }, include: entryInclude });
      if (!initial) throw errors.notFound('Transaction not found.');

      await lockAccount(tx, initial.accountId);

      const entry = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId }, include: entryInclude });
      if (entry.approvalStatus === 'REJECTED') {
        return {
          status: 200,
          body: {
            transaction: serializeTransaction(entry),
            account: await accountSummary(tx, entry.accountId),
            alreadyRejected: true,
          },
        };
      }
      if (entry.approvalStatus === 'APPROVED') {
        throw errors.conflict('ALREADY_APPROVED', 'Approved entries cannot be rejected. Create a reversal instead.');
      }

      const updated = await tx.ledgerEntry.update({
        where: { id: entryId },
        data: {
          approvalStatus: 'REJECTED',
          reviewedById: actorId,
          reviewedAt: new Date(),
          rejectionReason: input.reason,
        },
        include: entryInclude,
      });

      await writeAudit(tx, {
        action: 'LEDGER_ENTRY_REJECTED',
        entityType: 'LedgerEntry',
        entityId: updated.id,
        actorId,
        details: {
          accountId: updated.accountId,
          type: updated.type,
          amount: formatMoney(updated.amount),
          reason: input.reason,
        },
      });

      return {
        status: 200,
        body: {
          transaction: serializeTransaction(updated),
          account: await accountSummary(tx, updated.accountId),
        },
      };
    },
  });
}

/**
 * Reverses a posted entry by inserting an opposite entry that references it.
 * The original row is never modified. Each entry can be reversed at most once (unique constraint + check).
 */
export async function reverseTransaction(entryId: number, input: ReverseBody, actorId: number, key: string) {
  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);
  return withIdempotency({
    scope: `POST /api/transactions/${entryId}/reversal`,
    key,
    payload: { entryId, ...input },
    work: async (tx) => {
      const original = await tx.ledgerEntry.findUnique({ where: { id: entryId }, include: entryInclude });
      if (!original) throw errors.notFound('Transaction not found.');
      if (original.type === 'REVERSAL') {
        throw errors.unprocessable('CANNOT_REVERSE_REVERSAL', 'A reversal entry cannot be reversed. Post a new transaction instead.');
      }
      if (original.approvalStatus !== 'APPROVED') {
        throw errors.unprocessable('ENTRY_NOT_APPROVED', 'Only approved entries can be reversed.');
      }

      // Lock the account first so concurrent reversals/postings for it are serialized.
      const account = await lockAccount(tx, original.accountId);
      const existing = await tx.ledgerEntry.findUnique({ where: { reversalOfId: entryId }, select: { id: true } });
      if (existing || original.reversedBy) {
        throw errors.conflict('ALREADY_REVERSED', `This transaction was already reversed (entry #${existing?.id ?? original.reversedBy?.id}).`);
      }
      if (!account.isActive) {
        throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before reversing transactions.');
      }

      const entryDate = input.entryDate ?? today;
      assertNotFuture(entryDate, today);
      if (entryDate < dbDateToIso(original.entryDate)) {
        throw errors.unprocessable(
          'REVERSAL_DATE_BEFORE_ORIGINAL',
          'The reversal date cannot be earlier than the original transaction date.',
          [{ field: 'entryDate', message: 'Choose the original date or later.' }],
        );
      }

      const oppositeDirection = original.direction === 'INCREASE' ? 'DECREASE' : 'INCREASE';
      const reversal = await tx.ledgerEntry.create({
        data: {
          accountId: original.accountId,
          entryDate: isoDateToDbDate(entryDate),
          type: 'REVERSAL',
          side: original.side,
          direction: oppositeDirection,
          amount: original.amount,
          paymentMethod: original.paymentMethod,
          referenceNumber: original.referenceNumber,
          notes: `Reversal of entry #${original.id}. Reason: ${input.reason}`.slice(0, 500),
          reversalOfId: original.id,
          approvalStatus: 'APPROVED',
          reviewedById: actorId,
          reviewedAt: new Date(),
          createdById: actorId,
        },
        include: entryInclude,
      });

      await writeAudit(tx, {
        action: 'LEDGER_ENTRY_REVERSED',
        entityType: 'LedgerEntry',
        entityId: original.id,
        actorId,
        details: {
          originalEntryId: original.id,
          reversalEntryId: reversal.id,
          accountId: original.accountId,
          originalType: original.type,
          side: original.side,
          originalDirection: original.direction,
          reversalDirection: oppositeDirection,
          amount: formatMoney(original.amount),
          reason: input.reason,
          entryDate,
        },
      });

      return {
        status: 201,
        body: {
          reversal: serializeTransaction(reversal),
          original: { id: original.id, isReversed: true, reversedById: reversal.id },
          account: await accountSummary(tx, original.accountId),
        },
      };
    },
  });
}

export async function listTransactions(query: TransactionsQuery) {
  const term = query.search?.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  const where: Prisma.LedgerEntryWhereInput = {
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.type ? { type: query.type as TransactionType } : {}),
    ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
    ...(!query.includeReversals ? { type: { not: 'REVERSAL' } } : {}),
    ...(query.from || query.to
      ? {
          entryDate: {
            ...(query.from ? { gte: isoDateToDbDate(query.from) } : {}),
            ...(query.to ? { lte: isoDateToDbDate(query.to) } : {}),
          },
        }
      : {}),
    ...(term
      ? {
          OR: [
            { referenceNumber: { contains: term } },
            { notes: { contains: term } },
            { account: { name: { contains: term } } },
            { account: { accountCode: { contains: term } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(serializeTransaction),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function getTransaction(id: number) {
  const entry = await prisma.ledgerEntry.findUnique({ where: { id }, include: entryInclude });
  if (!entry) throw errors.notFound('Transaction not found.');
  return serializeTransaction(entry);
}

