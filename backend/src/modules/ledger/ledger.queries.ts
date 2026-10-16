import type { Tx, DbClient } from '../../db/prisma.ts';
import type { BalanceSide, AccountType } from '../../generated/prisma/client.ts';
import { money, ZERO, type Money } from '../../lib/money.ts';
import { balancesFromAggregates, type AccountBalances, type SideAggregate } from './ledger.balance.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from './ledger.rules.ts';

export type AccountAggregateInfo = {
  balances: AccountBalances;
  totalIncrease: Money;
  totalDecrease: Money;
  pendingSubmissionsCount: number;
  pendingSubmissionsAmount: Money;
  entryCount: number;
  lastEntryDate: string | null;
};

/** Loads opening data plus side/direction totals for many accounts in two queries. */
export async function loadBalances(
  db: DbClient | Tx,
  accountIds: number[],
): Promise<Map<number, AccountAggregateInfo>> {
  const result = new Map<number, AccountAggregateInfo>();
  if (accountIds.length === 0) return result;

  const [accounts, groups, pendingGroups, last] = await Promise.all([
    db.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, type: true, openingBalance: true, openingBalanceSide: true },
    }),
    db.ledgerEntry.groupBy({
      by: ['accountId', 'side', 'direction'],
      where: { accountId: { in: accountIds }, approvalStatus: 'APPROVED' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { accountId: { in: accountIds }, approvalStatus: 'PENDING' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { accountId: { in: accountIds } },
      _max: { entryDate: true },
      _count: { _all: true },
    }),
  ]);

  const aggByAccount = new Map<number, SideAggregate[]>();
  for (const group of groups) {
    const list = aggByAccount.get(group.accountId) ?? [];
    list.push({ side: group.side as BalanceSide, direction: group.direction, total: money(group._sum.amount ?? 0) });
    aggByAccount.set(group.accountId, list);
  }
  const pendingByAccount = new Map(
    pendingGroups.map((row) => [
      row.accountId,
      {
        count: row._count._all,
        amount: money(row._sum.amount ?? 0),
      },
    ]),
  );
  const lastByAccount = new Map(
    last.map((row) => [
      row.accountId,
      {
        count: row._count._all,
        lastDate: row._max.entryDate ? row._max.entryDate.toISOString().slice(0, 10) : null,
      },
    ]),
  );

  for (const account of accounts) {
    const lastInfo = lastByAccount.get(account.id);
    const pendingInfo = pendingByAccount.get(account.id);
    const aggs = aggByAccount.get(account.id) ?? [];
    const normalSide = NORMAL_SIDE_BY_ACCOUNT_TYPE[account.type];
    let totalIncrease: Money = account.openingBalanceSide === normalSide ? money(account.openingBalance) : ZERO;
    let totalDecrease: Money = ZERO;
    for (const a of aggs) {
      if (a.side === normalSide) {
        if (a.direction === 'INCREASE') totalIncrease = totalIncrease.plus(a.total);
        else totalDecrease = totalDecrease.plus(a.total);
      }
    }
    result.set(account.id, {
      balances: balancesFromAggregates(money(account.openingBalance), account.openingBalanceSide, aggs),
      totalIncrease,
      totalDecrease,
      pendingSubmissionsCount: pendingInfo?.count ?? 0,
      pendingSubmissionsAmount: pendingInfo?.amount ?? ZERO,
      entryCount: lastInfo?.count ?? 0,
      lastEntryDate: lastInfo?.lastDate ?? null,
    });
  }
  return result;
}

/** The balance an account is expected to carry on its normal side (customer = receivable, supplier = payable). */
export function primaryBalance(type: AccountType, balances: AccountBalances): Money {
  return NORMAL_SIDE_BY_ACCOUNT_TYPE[type] === 'RECEIVABLE' ? balances.receivable : balances.payable;
}

/** The side that is NOT normal for the account type. Non-zero means an unusual cross-side balance. */
export function crossSideBalance(type: AccountType, balances: AccountBalances): Money {
  return NORMAL_SIDE_BY_ACCOUNT_TYPE[type] === 'RECEIVABLE' ? balances.payable : balances.receivable;
}
