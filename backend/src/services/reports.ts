import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { errors } from '../lib/errors.ts';
import { formatMoney, money, ZERO } from '../lib/money.ts';
import { num } from '../lib/validation.ts';
import { serializeTransaction, transactionInclude, type TransactionWithRelations } from './transactions.ts';

function emptyTotals() {
  return { deposits: ZERO, withdrawals: ZERO, pendingAmount: ZERO,
    approvedEntries: 0, pendingEntries: 0, rejectedEntries: 0, totalEntries: 0 };
}
type Totals = ReturnType<typeof emptyTotals>;
function add(totals: Totals, row: TransactionWithRelations) {
  totals.totalEntries++;
  if (row.approvalStatus === 'APPROVED') {
    totals.approvedEntries++;
    if (row.kind === 'DEPOSIT') totals.deposits = totals.deposits.plus(money(row.amount));
    else totals.withdrawals = totals.withdrawals.plus(money(row.amount));
  } else if (row.approvalStatus === 'PENDING') {
    totals.pendingEntries++;
    totals.pendingAmount = totals.pendingAmount.plus(money(row.amount));
  } else if (row.approvalStatus === 'REJECTED') totals.rejectedEntries++;
}
function serialize(totals: Totals) {
  return { ...totals, deposits: formatMoney(totals.deposits), withdrawals: formatMoney(totals.withdrawals),
    net: formatMoney(totals.deposits.minus(totals.withdrawals)), pendingAmount: formatMoney(totals.pendingAmount) };
}

/** One bounded result supplies history and exact-decimal comparisons, so no page-sized sums. */
export type ReportWhere = Omit<Prisma.TransactionWhereInput, 'userId'> & { userId?: { in: bigint[] } };
export async function combinedReport(where: ReportWhere) {
  const [rows, users] = await Promise.all([
    prisma.transaction.findMany({ where, include: transactionInclude,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], take: 10_001 }),
    prisma.user.findMany({ where: { role: 'USER', ...(where.userId ? { id: { in: where.userId.in } } : {}) },
      select: { id: true, name: true, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
  ]);
  if (rows.length > 10_000) throw errors.badRequest('Too many entries for one report. Narrow the date range.');
  const totals = emptyTotals();
  const staff = new Map(users.map((user) => [user.id, { user, totals: emptyTotals() }]));
  const books = new Map<bigint | null, { name: string; totals: Totals }>();
  for (const row of rows) {
    add(totals, row);
    const staffRow = staff.get(row.userId);
    if (staffRow) add(staffRow.totals, row);
    const book = books.get(row.bookId) ?? { name: row.book?.name ?? 'No book assigned', totals: emptyTotals() };
    add(book.totals, row);
    books.set(row.bookId, book);
  }
  return {
    rows: rows.map(serializeTransaction), summary: serialize(totals),
    staffSummary: [...staff.values()].map(({ user, totals: staffTotals }) => ({
      userId: num(user.id)!, name: user.name, isActive: user.isActive, ...serialize(staffTotals),
    })),
    bookSummary: [...books.entries()].map(([bookId, book]) => ({ bookId: num(bookId), name: book.name,
      ...serialize(book.totals) })).sort((a, b) => a.name.localeCompare(b.name) || (a.bookId ?? 0) - (b.bookId ?? 0)),
  };
}
