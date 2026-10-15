import { prisma } from '../../db/prisma.ts';
import { formatMoney, money, ZERO, type Money } from '../../lib/money.ts';
import { isoDateToDbDate, todayInTimeZone } from '../../lib/dates.ts';
import { getSettings } from '../settings/settings.service.ts';
import { balancesFromAggregates, describeBalance, type SideAggregate } from '../ledger/ledger.balance.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from '../ledger/ledger.rules.ts';
import { serializeTransaction } from '../transactions/transactions.service.ts';
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

  const [accounts, aggregates, todayPayments, transactionsToday, recent, entryCount] = await Promise.all([
    prisma.account.findMany({
      select: { id: true, accountCode: true, name: true, type: true, isActive: true, openingBalance: true, openingBalanceSide: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['accountId', 'side', 'direction'],
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['type'],
      where: { entryDate: todayDate, type: { in: ['PAYMENT_RECEIVED', 'PAYMENT_MADE'] } },
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

  let receivableTotal: Money = ZERO;
  let payableTotal: Money = ZERO;
  let customerCredits: Money = ZERO;
  let supplierCredits: Money = ZERO;
  let customersWithBalance = 0;
  let suppliersWithBalance = 0;
  const outstanding: Array<{ account: (typeof accounts)[number]; balance: Money; side: BalanceSide }> = [];

  for (const account of accounts) {
    const balances = balancesFromAggregates(money(account.openingBalance), account.openingBalanceSide, aggByAccount.get(account.id) ?? []);
    receivableTotal = receivableTotal.plus(balances.receivable);
    payableTotal = payableTotal.plus(balances.payable);

    const normal = NORMAL_SIDE_BY_ACCOUNT_TYPE[account.type];
    const primary = normal === 'RECEIVABLE' ? balances.receivable : balances.payable;
    if (account.type === 'CUSTOMER') {
      if (primary.gt(0)) customersWithBalance += 1;
      if (primary.lt(0)) customerCredits = customerCredits.plus(primary.abs());
    } else {
      if (primary.gt(0)) suppliersWithBalance += 1;
      if (primary.lt(0)) supplierCredits = supplierCredits.plus(primary.abs());
    }
    if (!primary.isZero()) outstanding.push({ account, balance: primary, side: normal });
  }

  outstanding.sort((a, b) => {
    const diff = b.balance.abs().comparedTo(a.balance.abs());
    return diff !== 0 ? diff : a.account.id - b.account.id;
  });

  const paid = todayPayments.find((row) => row.type === 'PAYMENT_MADE');
  const received = todayPayments.find((row) => row.type === 'PAYMENT_RECEIVED');

  return {
    today,
    timezone: settings.timezone,
    currencySymbol: settings.currencySymbol,
    counts: {
      activeCustomers: accounts.filter((a) => a.type === 'CUSTOMER' && a.isActive).length,
      inactiveCustomers: accounts.filter((a) => a.type === 'CUSTOMER' && !a.isActive).length,
      activeSuppliers: accounts.filter((a) => a.type === 'SUPPLIER' && a.isActive).length,
      inactiveSuppliers: accounts.filter((a) => a.type === 'SUPPLIER' && !a.isActive).length,
      ledgerEntries: entryCount,
      entriesToday: transactionsToday,
      customersWithBalance,
      suppliersWithBalance,
    },
    receivables: {
      total: formatMoney(receivableTotal),
      credits: formatMoney(customerCredits),
      description: 'Net amount customers owe the business (credit balances are subtracted).',
    },
    payables: {
      total: formatMoney(payableTotal),
      credits: formatMoney(supplierCredits),
      description: 'Net amount the business owes suppliers (supplier credits are subtracted).',
    },
    todayPayments: {
      received: formatMoney(received?._sum.amount ?? 0),
      receivedCount: received?._count._all ?? 0,
      paid: formatMoney(paid?._sum.amount ?? 0),
      paidCount: paid?._count._all ?? 0,
      date: today,
    },
    recentTransactions: recent.map(serializeTransaction),
    outstandingAccounts: outstanding.slice(0, 10).map(({ account, balance, side }) => {
      const description = describeBalance(balance);
      return {
        id: account.id,
        accountCode: account.accountCode,
        name: account.name,
        type: account.type,
        isActive: account.isActive,
        balance: { amount: formatMoney(balance), side, status: description.status },
      };
    }),
    outstandingCount: outstanding.length,
  };
}
