import { Prisma } from '@prisma/client';
import type { Db } from '../db/prisma.ts';
import { dbDateToIso } from '../lib/dates.ts';
import { errors } from '../lib/errors.ts';
import { formatMoney, money, ZERO } from '../lib/money.ts';
import { num } from '../lib/validation.ts';

export function describeBalance(net: Prisma.Decimal) {
  return { amount: formatMoney(net.abs()), side: 'RECEIVABLE' as const,
    status: net.isZero() ? 'SETTLED' as const : net.isNegative() ? 'CREDIT' as const : 'DUE' as const };
}

export async function financialTotals(db: Db, userId: bigint, from?: Date, to?: Date, bookId?: bigint) {
  const rows = await db.transaction.groupBy({
    by: ['kind', 'approvalStatus'],
    where: { userId, ...(bookId ? { bookId } : {}),
      ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    _sum: { amount: true }, _count: { _all: true },
  });
  let deposits = ZERO, withdrawals = ZERO, pendingAmount = ZERO;
  let count = 0, pendingCount = 0;
  for (const row of rows) {
    const sum = money(row._sum.amount ?? '0');
    if (row.approvalStatus === 'APPROVED') {
      if (row.kind === 'DEPOSIT') deposits = deposits.plus(sum);
      else withdrawals = withdrawals.plus(sum);
      count += row._count._all;
    } else if (row.approvalStatus === 'PENDING') {
      pendingAmount = pendingAmount.plus(sum);
      pendingCount += row._count._all;
    }
  }
  return { deposits, withdrawals, net: deposits.minus(withdrawals), pendingAmount, pendingCount, count };
}

export async function summary(db: Db, userId: bigint) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { books: true } });
  if (!user || user.role !== 'USER') throw errors.notFound('User account not found.');
  const [totals, last] = await Promise.all([
    financialTotals(db, userId),
    db.transaction.findFirst({ where: { userId }, orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], select: { entryDate: true } }),
  ]);
  return {
    id: num(user.id)!, accountCode: user.accountCode, name: user.name, username: user.name,
    hasLogin: true, type: 'CUSTOMER' as const, typeLabel: 'User',
    phone: user.phone, email: user.email, address: user.address, notes: user.notes,
    openingBalance: '0.00', openingBalanceSide: 'RECEIVABLE' as const, normalSide: 'RECEIVABLE' as const,
    totalCredited: formatMoney(totals.deposits), totalPaid: formatMoney(totals.withdrawals),
    totalUserPaid: formatMoney(totals.deposits), totalAdminPaid: formatMoney(totals.withdrawals),
    pendingBalance: formatMoney(totals.net), pendingSubmissionsCount: totals.pendingCount,
    pendingSubmissionsAmount: formatMoney(totals.pendingAmount), balance: describeBalance(totals.net),
    balances: { receivable: formatMoney(totals.net), payable: '0.00' }, crossSideBalance: null,
    isActive: user.isActive, entryCount: totals.count,
    lastEntryDate: last ? dbDateToIso(last.entryDate) : null,
    hasPin: !!(user.pin || user.pinHash),
    allowedBookIds: user.books.map((link) => num(link.bookId)!).sort((a, b) => a - b),
    backDateAllowedDate: user.backDateAllowedDate ? dbDateToIso(user.backDateAllowedDate) : null,
    createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(),
  };
}

export function optionFromSummary(row: Awaited<ReturnType<typeof summary>>) {
  return { id: row.id, accountCode: row.accountCode, name: row.name, username: row.username,
    type: row.type, isActive: row.isActive, totalUserPaid: row.totalUserPaid,
    totalAdminPaid: row.totalAdminPaid, pendingBalance: row.pendingBalance, balance: row.balance };
}
