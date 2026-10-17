import { Prisma } from '@prisma/client';
import { prisma, type Db, type Tx } from '../db/prisma.ts';
import { audit } from '../lib/audit.ts';
import { dbDateToIso, isoDateToDbDate } from '../lib/dates.ts';
import { errors } from '../lib/errors.ts';
import { formatMoney, money, ZERO } from '../lib/money.ts';
import { nullableString, num } from '../lib/validation.ts';

export const transactionInclude = {
  user: { select: { id: true, accountCode: true, name: true } },
  book: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.TransactionInclude;
export type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

export function descriptionOf(row: { optionName: string; detail: string | null }): string {
  return [row.optionName, row.detail].filter(Boolean).join(' — ');
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank Transfer', OTHER: 'Other',
};
export function serializeTransaction(row: TransactionWithRelations) {
  const isReversal = row.reversalOfId !== null;
  return {
    id: num(row.id)!, entryDate: dbDateToIso(row.entryDate),
    type: isReversal ? 'REVERSAL' : row.kind,
    typeLabel: isReversal ? 'Reversal' : row.kind === 'DEPOSIT' ? 'Deposit' : 'Withdrawal',
    side: 'RECEIVABLE' as const, direction: row.kind === 'DEPOSIT' ? 'INCREASE' as const : 'DECREASE' as const,
    amount: formatMoney(row.amount), option: row.optionName, detail: row.detail,
    bookId: num(row.bookId), bookName: row.book?.name ?? null,
    customerId: row.customerId, bankDetails: row.bankDetails,
    description: descriptionOf(row), paymentMethod: row.paymentMethod,
    paymentMethodLabel: row.paymentMethod ? METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod : row.optionName,
    referenceNumber: row.referenceNumber, notes: descriptionOf(row),
    reversalOfId: num(row.reversalOfId), reversedById: num(row.reversedById),
    isReversal, isReversed: row.reversedById !== null,
    approvalStatus: row.approvalStatus,
    reviewedBy: row.reviewedBy ? { id: num(row.reviewedBy.id), username: row.reviewedBy.name } : null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null, rejectionReason: row.rejectionReason,
    account: { id: num(row.user.id)!, accountCode: row.user.accountCode, name: row.user.name,
      type: 'CUSTOMER' as const, typeLabel: 'User' },
    createdById: num(row.createdById), createdAt: row.createdAt.toISOString(),
  };
}

export async function loadTransaction(db: Db, entryId: bigint) {
  const row = await db.transaction.findUnique({ where: { id: entryId }, include: transactionInclude });
  if (!row) throw errors.notFound('Transaction not found.');
  return row;
}

/** Admission rules shared by API and tests. Never accept a client-supplied sign/direction. */
export function parseKind(type: string): 'DEPOSIT' | 'WITHDRAWAL' {
  switch (type.toUpperCase().replaceAll('-', '_')) {
    case 'DEPOSIT': case 'CREDIT_SALE': case 'CREDIT_PURCHASE': case 'INCREASE': case 'PAYMENT_RECEIVED_IN':
      return 'DEPOSIT';
    case 'WITHDRAWAL': case 'PAYMENT_RECEIVED': case 'PAYMENT_MADE':
    case 'CUSTOMER_CREDIT_ADJUSTMENT': case 'SUPPLIER_CREDIT_ADJUSTMENT': case 'DECREASE':
      return 'WITHDRAWAL';
    default: throw errors.badRequest('Choose Deposit or Withdrawal.');
  }
}

export function checkPostingDate(entryDate: string, today: string, role: 'ADMIN' | 'USER', allowedBackDate?: string | null) {
  if (entryDate > today) throw errors.unprocessable('FUTURE_DATE', `The date cannot be in the future (today is ${today}).`,
    [{ field: 'entryDate', message: 'Choose today or an earlier date.' }]);
  if (role === 'USER' && entryDate < today && entryDate !== allowedBackDate) {
    throw errors.forbidden(`Your administrator has not granted back-date permission for ${entryDate}.`);
  }
}

export async function validateOption(db: Db, raw: string): Promise<string> {
  const option = await db.entryOption.findUnique({ where: { nameNormalized: raw.trim().toLowerCase() } });
  if (!option?.isActive) throw errors.unprocessable('INVALID_ENTRY_OPTION',
    'Please select a valid option configured by the Administrator.',
    [{ field: 'optionName', message: 'Select an active option from Settings.' }]);
  return option.name;
}

export async function validateBook(db: Db, accountId: bigint, bookId: bigint | null, isStaff: boolean) {
  if (bookId !== null) {
    const book = await db.book.findUnique({ where: { id: bookId } });
    if (!book) throw errors.notFound('Book not found.');
    if (book.status !== 'ACTIVE') throw errors.unprocessable('BOOK_ARCHIVED', 'Archived books cannot receive entries.');
    if (isStaff && !await db.userBook.findUnique({ where: { userId_bookId: { userId: accountId, bookId } } })) {
      throw errors.forbidden('Your administrator has not granted access to this book.');
    }
  } else if (isStaff) {
    const activeAssigned = await db.userBook.count({ where: { userId: accountId, book: { status: 'ACTIVE' } } });
    if (activeAssigned) throw errors.forbidden('Select an active book assigned by your administrator.');
  }
}

export interface NewEntry {
  accountId: bigint;
  kind: 'DEPOSIT' | 'WITHDRAWAL';
  entryDate: string;
  amount: string;
  optionName: string;
  detail?: string | null;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  bookId?: bigint | null;
  customerId?: string | null;
  bankDetails?: string | null;
}

export async function insertEntry(tx: Tx, input: NewEntry, actorId: bigint, role: 'ADMIN' | 'USER', today: string) {
  const target = await tx.user.findUnique({ where: { id: input.accountId } });
  if (!target || target.role !== 'USER') throw errors.notFound('User account not found.');
  if (!target.isActive) throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before recording transactions.');
  checkPostingDate(input.entryDate, today, role,
    target.backDateAllowedDate ? dbDateToIso(target.backDateAllowedDate) : null);
  const optionName = await validateOption(tx, input.optionName);
  await validateBook(tx, input.accountId, input.bookId ?? null, role === 'USER');
  // Deposits are posted immediately for staff; withdrawals remain queued for review.
  const pending = role === 'USER' && input.kind === 'WITHDRAWAL';
  const row = await tx.transaction.create({ data: {
    userId: input.accountId, kind: input.kind, entryDate: isoDateToDbDate(input.entryDate),
    amount: input.amount, optionName, detail: nullableString(input.detail),
    paymentMethod: nullableString(input.paymentMethod)?.toUpperCase() ?? null,
    referenceNumber: nullableString(input.referenceNumber), bookId: input.bookId ?? null,
    customerId: nullableString(input.customerId), bankDetails: nullableString(input.bankDetails),
    approvalStatus: pending ? 'PENDING' : 'APPROVED',
    reviewedById: pending ? null : actorId, reviewedAt: pending ? null : new Date(),
    createdById: actorId,
  }, include: transactionInclude });
  await audit(tx, 'TRANSACTION_CREATED', 'LedgerTransaction', row.id, actorId, {
    userId: input.accountId, kind: input.kind, amount: input.amount,
    entryDate: input.entryDate, option: optionName, approvalStatus: row.approvalStatus,
  });
  return row;
}

/** Row-level lock serializes decisions/reversals across different idempotency keys. */
export async function lockEntry(tx: Tx, entryId: bigint) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM transactions WHERE id = ${entryId} FOR UPDATE`;
  if (!rows.length) throw errors.notFound('Transaction not found.');
  return loadTransaction(tx, entryId);
}

/** Monetary totals cover the whole filtered result, not just the current page. */
export async function transactionTotals(where: Prisma.TransactionWhereInput) {
  const rows = await prisma.transaction.groupBy({
    by: ['kind'], where: { AND: [where, { approvalStatus: 'APPROVED' }] },
    _sum: { amount: true }, _count: { _all: true },
  });
  let deposits = ZERO, withdrawals = ZERO, approvedEntries = 0;
  for (const row of rows) {
    if (row.kind === 'DEPOSIT') deposits = deposits.plus(money(row._sum.amount ?? '0'));
    else withdrawals = withdrawals.plus(money(row._sum.amount ?? '0'));
    approvedEntries += row._count._all;
  }
  return { deposits: formatMoney(deposits), withdrawals: formatMoney(withdrawals),
    net: formatMoney(deposits.minus(withdrawals)), approvedEntries };
}
