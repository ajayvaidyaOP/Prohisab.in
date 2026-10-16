import { prisma } from '../../db/prisma.ts';
import { formatMoney, money, ZERO, type Money } from '../../lib/money.ts';
import { isoDateToDbDate, todayInTimeZone } from '../../lib/dates.ts';
import { getSettings } from '../settings/settings.service.ts';
import { balancesFromAggregates, describeBalance, type SideAggregate } from '../ledger/ledger.balance.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from '../ledger/ledger.rules.ts';
import { serializeTransaction } from '../transactions/transactions.service.ts';
import { buildAllUsersSummaryPdf } from '../../lib/pdf.ts';
import type { BalanceSide } from '../../generated/prisma/client.ts';

/**
 * Dashboard figures are computed from the database on every request (no stale caches):
 *  - balances: one query for opening balances and one GROUP BY over ledger entries
 *  - today: calendar date in the business time zone (Settings → Time zone)
 */
export async function getDashboard() {
  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);
  const todayDate = isoDateToDbDate(today);

  const [accounts, aggregates, pendingAggregates, todayByType, transactionsToday, recent, pendingEntries, entryCount] = await Promise.all([
    prisma.account.findMany({
      select: {
        id: true,
        accountCode: true,
        name: true,
        phone: true,
        type: true,
        isActive: true,
        openingBalance: true,
        openingBalanceSide: true,
        loginUser: { select: { username: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    prisma.ledgerEntry.groupBy({
      by: ['accountId', 'side', 'direction'],
      where: { approvalStatus: 'APPROVED' },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { approvalStatus: 'PENDING' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['type'],
      where: { entryDate: todayDate, approvalStatus: 'APPROVED' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.ledgerEntry.count({ where: { entryDate: todayDate } }),
    prisma.ledgerEntry.findMany({
      take: 10,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        account: { select: { id: true, accountCode: true, name: true, type: true } },
        reversedBy: { select: { id: true } },
        reviewedBy: { select: { id: true, username: true } },
      },
    }),
    prisma.ledgerEntry.findMany({
      where: { approvalStatus: 'PENDING' },
      take: 25,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        account: { select: { id: true, accountCode: true, name: true, type: true } },
        reversedBy: { select: { id: true } },
        reviewedBy: { select: { id: true, username: true } },
      },
    }),
    prisma.ledgerEntry.count(),
  ]);

  const aggByAccount = new Map<number, SideAggregate[]>();
  for (const group of aggregates) {
    const list = aggByAccount.get(group.accountId) ?? [];
    list.push({ side: group.side as BalanceSide, direction: group.direction, total: money(group._sum.amount ?? 0) });
    aggByAccount.set(group.accountId, list);
  }
  const pendingByAccount = new Map(
    pendingAggregates.map((row) => [
      row.accountId,
      {
        count: row._count._all,
        amount: money(row._sum.amount ?? 0),
      },
    ]),
  );

  let receivableTotal: Money = ZERO;
  let payableTotal: Money = ZERO;
  let customerCredits: Money = ZERO;
  let supplierCredits: Money = ZERO;
  let allUsersPaidTotal: Money = ZERO;
  let allAdminPaidTotal: Money = ZERO;
  let totalPendingSubmissionsCount = 0;
  let totalPendingSubmissionsAmount: Money = ZERO;
  for (const row of pendingAggregates) {
    totalPendingSubmissionsCount += row._count._all;
    totalPendingSubmissionsAmount = totalPendingSubmissionsAmount.plus(money(row._sum.amount ?? 0));
  }
  let customersWithBalance = 0;
  let suppliersWithBalance = 0;
  const outstanding: Array<{
    account: (typeof accounts)[number];
    balance: Money;
    side: BalanceSide;
    totalUserPaid: Money;
    totalAdminPaid: Money;
  }> = [];
  const usersOverview: Array<{
    id: number;
    accountCode: string;
    name: string;
    username: string | null;
    phone: string | null;
    type: (typeof accounts)[number]['type'];
    isActive: boolean;
    totalUserPaid: string;
    totalAdminPaid: string;
    pendingBalance: string;
    pendingSubmissionsCount: number;
    pendingSubmissionsAmount: string;
    balance: { amount: string; side: BalanceSide; status: 'DUE' | 'CREDIT' | 'SETTLED' };
  }> = [];

  for (const account of accounts) {
    const aggs = aggByAccount.get(account.id) ?? [];
    const pendingInfo = pendingByAccount.get(account.id);
    const balances = balancesFromAggregates(money(account.openingBalance), account.openingBalanceSide, aggs);
    receivableTotal = receivableTotal.plus(balances.receivable);
    payableTotal = payableTotal.plus(balances.payable);

    const normal = NORMAL_SIDE_BY_ACCOUNT_TYPE[account.type];
    const primary = normal === 'RECEIVABLE' ? balances.receivable : balances.payable;

    let userPaid: Money = account.openingBalanceSide === normal ? money(account.openingBalance) : ZERO;
    let adminPaid: Money = ZERO;
    for (const a of aggs) {
      if (a.side === normal) {
        if (a.direction === 'INCREASE') userPaid = userPaid.plus(a.total);
        else adminPaid = adminPaid.plus(a.total);
      }
    }
    allUsersPaidTotal = allUsersPaidTotal.plus(userPaid);
    allAdminPaidTotal = allAdminPaidTotal.plus(adminPaid);

    if (account.type === 'CUSTOMER') {
      if (primary.gt(0)) customersWithBalance += 1;
      if (primary.lt(0)) customerCredits = customerCredits.plus(primary.abs());
    } else {
      if (primary.gt(0)) suppliersWithBalance += 1;
      if (primary.lt(0)) supplierCredits = supplierCredits.plus(primary.abs());
    }
    if (!primary.isZero()) {
      outstanding.push({ account, balance: primary, side: normal, totalUserPaid: userPaid, totalAdminPaid: adminPaid });
    }
    const description = describeBalance(primary);
    usersOverview.push({
      id: account.id,
      accountCode: account.accountCode,
      name: account.name,
      username: account.loginUser?.username ?? null,
      phone: account.phone,
      type: account.type,
      isActive: account.isActive,
      totalUserPaid: formatMoney(userPaid),
      totalAdminPaid: formatMoney(adminPaid),
      pendingBalance: formatMoney(primary),
      pendingSubmissionsCount: pendingInfo?.count ?? 0,
      pendingSubmissionsAmount: formatMoney(pendingInfo?.amount ?? ZERO),
      balance: { amount: formatMoney(primary), side: normal, status: description.status },
    });
  }

  outstanding.sort((a, b) => {
    const diff = b.balance.abs().comparedTo(a.balance.abs());
    return diff !== 0 ? diff : a.account.id - b.account.id;
  });

  const paid = todayByType.find((row) => row.type === 'PAYMENT_MADE');
  const received = todayByType.find((row) => row.type === 'PAYMENT_RECEIVED');
  const creditPurchaseToday = todayByType.find((row) => row.type === 'CREDIT_PURCHASE');
  const creditSaleToday = todayByType.find((row) => row.type === 'CREDIT_SALE');
  const todayUserPaidAmount = money(creditPurchaseToday?._sum.amount ?? 0).plus(money(creditSaleToday?._sum.amount ?? 0));
  const todayUserPaidCount = (creditPurchaseToday?._count._all ?? 0) + (creditSaleToday?._count._all ?? 0);
  const todayAdminPaidAmount = money(paid?._sum.amount ?? 0).plus(money(received?._sum.amount ?? 0));
  const todayAdminPaidCount = (paid?._count._all ?? 0) + (received?._count._all ?? 0);

  return {
    today,
    timezone: settings.timezone,
    currencySymbol: settings.currencySymbol,
    counts: {
      activeCustomers: accounts.filter((a) => a.type === 'CUSTOMER' && a.isActive).length,
      inactiveCustomers: accounts.filter((a) => a.type === 'CUSTOMER' && !a.isActive).length,
      activeSuppliers: accounts.filter((a) => a.type === 'SUPPLIER' && a.isActive).length,
      inactiveSuppliers: accounts.filter((a) => a.type === 'SUPPLIER' && !a.isActive).length,
      totalUsers: accounts.length,
      activeUsers: accounts.filter((a) => a.isActive).length,
      ledgerEntries: entryCount,
      entriesToday: transactionsToday,
      customersWithBalance,
      suppliersWithBalance,
      pendingSubmissionsCount: totalPendingSubmissionsCount,
    },
    userLedgerTotals: {
      totalUserPaid: formatMoney(allUsersPaidTotal),
      totalAdminPaid: formatMoney(allAdminPaidTotal),
      totalPending: formatMoney(allUsersPaidTotal.minus(allAdminPaidTotal)),
      pendingSubmissionsCount: totalPendingSubmissionsCount,
      pendingSubmissionsAmount: formatMoney(totalPendingSubmissionsAmount),
      todayUserPaid: formatMoney(todayUserPaidAmount),
      todayUserPaidCount,
      todayAdminPaid: formatMoney(todayAdminPaidAmount),
      todayAdminPaidCount,
    },
    receivables: {
      total: formatMoney(receivableTotal),
      credits: formatMoney(customerCredits),
      description: 'Net amount customers owe the business (credit balances are subtracted).',
    },
    payables: {
      total: formatMoney(payableTotal),
      credits: formatMoney(supplierCredits),
      description: 'Net amount the business owes users (credits are subtracted).',
    },
    todayPayments: {
      received: formatMoney(received?._sum.amount ?? 0),
      receivedCount: received?._count._all ?? 0,
      paid: formatMoney(paid?._sum.amount ?? 0),
      paidCount: paid?._count._all ?? 0,
      date: today,
    },
    pendingEntries: pendingEntries.map(serializeTransaction),
    recentTransactions: recent.map(serializeTransaction),
    outstandingAccounts: outstanding.slice(0, 10).map(({ account, balance, side, totalUserPaid, totalAdminPaid }) => {
      const description = describeBalance(balance);
      return {
        id: account.id,
        accountCode: account.accountCode,
        name: account.name,
        username: account.loginUser?.username ?? null,
        type: account.type,
        isActive: account.isActive,
        totalUserPaid: formatMoney(totalUserPaid),
        totalAdminPaid: formatMoney(totalAdminPaid),
        pendingBalance: formatMoney(balance),
        balance: { amount: formatMoney(balance), side, status: description.status },
      };
    }),
    usersOverview,
    outstandingCount: outstanding.length,
  };
}

export async function exportAllUsersSummaryPdf(): Promise<{ filename: string; content: Buffer }> {
  const [settings, data] = await Promise.all([getSettings(), getDashboard()]);
  const pdfBuffer = buildAllUsersSummaryPdf({
    businessName: settings.businessName,
    generatedDate: data.today,
    totalDeposit: data.userLedgerTotals.totalUserPaid,
    totalWithdrawal: data.userLedgerTotals.totalAdminPaid,
    totalNetBalance: data.userLedgerTotals.totalPending,
    totalPendingCount: data.userLedgerTotals.pendingSubmissionsCount,
    totalPendingAmount: data.userLedgerTotals.pendingSubmissionsAmount,
    rows: data.usersOverview.map((u) => ({
      accountCode: u.accountCode,
      name: u.name,
      username: u.username,
      totalDeposit: u.totalUserPaid,
      totalWithdrawal: u.totalAdminPaid,
      netBalance: u.pendingBalance,
      pendingCount: u.pendingSubmissionsCount,
      pendingAmount: u.pendingSubmissionsAmount,
    })),
  });
  return {
    filename: `all-users-summary-${data.today}.pdf`,
    content: pdfBuffer,
  };
}

