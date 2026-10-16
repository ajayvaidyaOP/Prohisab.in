import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { isoDateToDbDate } from '../lib/dates.ts';
import { errors } from '../lib/errors.ts';
import { formatMoney, money, ZERO } from '../lib/money.ts';
import { dateRange, id, num, textParam } from '../lib/validation.ts';
import { describeBalance } from './accounts.ts';
import { businessView } from './settings.ts';
import { serializeTransaction, transactionInclude } from './transactions.ts';

interface Tally {
  deposits: Prisma.Decimal;
  withdrawals: Prisma.Decimal;
  pendingAmount: Prisma.Decimal;
  pendingCount: number;
}
function empty(): Tally { return { deposits: ZERO, withdrawals: ZERO, pendingAmount: ZERO, pendingCount: 0 }; }

export async function dashboardData(query: Record<string, unknown>) {
  const { from, to, where: entryDate } = dateRange(query);
  const bookId = textParam(query.bookId) ? id(query.bookId, 'bookId') : undefined;
  const userId = textParam(query.userId) ? id(query.userId, 'userId') : undefined;
  if (bookId && !await prisma.book.findUnique({ where: { id: bookId } })) throw errors.notFound('Book not found.');
  if (userId && !await prisma.user.findFirst({ where: { id: userId, role: 'USER' } })) throw errors.notFound('Staff account not found.');
  const business = await businessView(prisma);
  const today = (await import('../lib/dates.ts')).todayInTimeZone(business.timezone);
  const users = await prisma.user.findMany({ where: { role: 'USER', ...(userId ? { id: userId } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
      id: true, name: true, accountCode: true, phone: true, isActive: true,
    } });
  const where = { user: { role: 'USER' }, ...(userId ? { userId } : {}),
    ...(bookId ? { bookId } : {}), ...(entryDate ? { entryDate } : {}) };
  const grouped = await prisma.transaction.groupBy({ by: ['userId', 'kind', 'approvalStatus'],
    where, _sum: { amount: true }, _count: { _all: true } });
  const map = new Map<bigint, Tally>();
  let approvedCount = 0, pendingCount = 0;
  for (const row of grouped) {
    const total = map.get(row.userId) ?? empty();
    const sum = money(row._sum.amount ?? '0');
    if (row.approvalStatus === 'APPROVED') {
      if (row.kind === 'DEPOSIT') total.deposits = total.deposits.plus(sum);
      else total.withdrawals = total.withdrawals.plus(sum);
      approvedCount += row._count._all;
    } else if (row.approvalStatus === 'PENDING') {
      total.pendingCount += row._count._all;
      total.pendingAmount = total.pendingAmount.plus(sum);
      pendingCount += row._count._all;
    }
    map.set(row.userId, total);
  }
  let deposits = ZERO, withdrawals = ZERO, pendingAmount = ZERO;
  const overviews = users.map((user) => {
    const t = map.get(user.id) ?? empty();
    deposits = deposits.plus(t.deposits);
    withdrawals = withdrawals.plus(t.withdrawals);
    pendingAmount = pendingAmount.plus(t.pendingAmount);
    const net = t.deposits.minus(t.withdrawals);
    return { id: num(user.id)!, accountCode: user.accountCode, name: user.name, username: user.name,
      phone: user.phone, type: 'CUSTOMER' as const, isActive: user.isActive,
      totalUserPaid: formatMoney(t.deposits), totalAdminPaid: formatMoney(t.withdrawals),
      pendingBalance: formatMoney(net), pendingSubmissionsCount: t.pendingCount,
      pendingSubmissionsAmount: formatMoney(t.pendingAmount), balance: describeBalance(net) };
  });
  const outstanding = overviews.filter((row) => row.balance.status !== 'SETTLED').map((row) => ({
    id: row.id, accountCode: row.accountCode, name: row.name, username: row.username,
    type: row.type, isActive: row.isActive, totalUserPaid: row.totalUserPaid,
    totalAdminPaid: row.totalAdminPaid, pendingBalance: row.pendingBalance, balance: row.balance,
  }));
  const todayInRange = (!from || today >= from) && (!to || today <= to);
  const todayGrouped = todayInRange ? await prisma.transaction.groupBy({ by: ['kind'],
    where: { ...where, approvalStatus: 'APPROVED', entryDate: isoDateToDbDate(today) },
    _sum: { amount: true }, _count: { _all: true } }) : [];
  const todayDeposit = todayGrouped.find((row) => row.kind === 'DEPOSIT');
  const todayWithdrawal = todayGrouped.find((row) => row.kind === 'WITHDRAWAL');
  const todayDeposits = money(todayDeposit?._sum.amount ?? '0');
  const todayWithdrawals = money(todayWithdrawal?._sum.amount ?? '0');
  const todayDepositCount = todayDeposit?._count._all ?? 0;
  const todayWithdrawalCount = todayWithdrawal?._count._all ?? 0;
  const [pendingEntries, recentTransactions, activeBooks] = await Promise.all([
    prisma.transaction.findMany({ where: { ...where, approvalStatus: 'PENDING' }, include: transactionInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 }),
    prisma.transaction.findMany({ where, include: transactionInclude,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], take: 10 }),
    bookId ? prisma.book.count({ where: { id: bookId, status: 'ACTIVE' } })
      : userId ? prisma.userBook.count({ where: { userId, book: { status: 'ACTIVE' } } })
        : prisma.book.count({ where: { status: 'ACTIVE' } }),
  ]);
  const net = deposits.minus(withdrawals);
  const activeUsers = users.filter((user) => user.isActive).length;
  return {
    today, timezone: business.timezone, currencySymbol: business.currencySymbol,
    counts: { activeCustomers: activeUsers, inactiveCustomers: users.length - activeUsers,
      activeSuppliers: 0, inactiveSuppliers: 0, totalUsers: users.length, activeUsers,
      ledgerEntries: approvedCount, entriesToday: todayDepositCount + todayWithdrawalCount,
      customersWithBalance: outstanding.length, suppliersWithBalance: 0,
      pendingSubmissionsCount: pendingCount, activeBooks },
    userLedgerTotals: { totalUserPaid: formatMoney(deposits), totalAdminPaid: formatMoney(withdrawals),
      totalPending: formatMoney(net), pendingSubmissionsCount: pendingCount,
      pendingSubmissionsAmount: formatMoney(pendingAmount),
      todayUserPaid: formatMoney(todayDeposits), todayUserPaidCount: todayDepositCount,
      todayAdminPaid: formatMoney(todayWithdrawals), todayAdminPaidCount: todayWithdrawalCount },
    receivables: { total: formatMoney(net), credits: '0.00',
      description: 'Net of approved deposits (+) and withdrawals (-) for this selection.' },
    payables: { total: '0.00', credits: '0.00', description: 'No payable accounts in this ledger model.' },
    todayPayments: { received: formatMoney(todayDeposits), receivedCount: todayDepositCount,
      paid: formatMoney(todayWithdrawals), paidCount: todayWithdrawalCount, date: today },
    pendingEntries: pendingEntries.map(serializeTransaction),
    recentTransactions: recentTransactions.map(serializeTransaction),
    outstandingAccounts: outstanding, usersOverview: overviews, outstandingCount: outstanding.length,
  };
}
