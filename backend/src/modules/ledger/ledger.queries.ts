import type { Tx, DbClient } from '../../db/prisma.ts';
import type { BalanceSide } from '../../generated/prisma/client.ts';
import { money, type Money } from '../../lib/money.ts';
import { balancesFromAggregates, type AccountBalances, type SideAggregate } from './ledger.balance.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from './ledger.rules.ts';
import type { AccountType } from '../../generated/prisma/client.ts';

/** Loads opening data plus side/direction totals for many accounts in two queries. */
export async function loadBalances(
  db: DbClient | Tx,
  accountIds: number[],
): Promise<Map<number, { balances: AccountBalances; entryCount: number; lastEntryDate: string | null }>> {
  const result = new Map<number, { balances: AccountBalances; entryCount: number; lastEntryDate: string | null }>();
  if (accountIds.length === 0) return result;

  const [accounts, groups, last] = await Promise.all([
    db.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, openingBalance: true, openingBalanceSide: true },
    }),
    db.ledgerEntry.groupBy({
      by: ['accountId', 'side', 'direction'],
      where: { accountId: { in: accountIds } },
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
    result.set(account.id, {
      balances: balancesFromAggregates(money(account.openingBalance), account.openingBalanceSide, aggByAccount.get(account.id) ?? []),
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
