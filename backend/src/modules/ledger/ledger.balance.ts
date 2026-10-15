import { Prisma } from '../../generated/prisma/client.ts';
import type { BalanceSide, EntryDirection } from '../../generated/prisma/client.ts';
import { formatMoney, money, ZERO, type Money } from '../../lib/money.ts';

/**
 * Pure ledger math. No database access here, so the rules are unit-testable.
 *
 * Signed balance on a side =
 *     opening balance (if the opening side matches)
 *   + sum(INCREASE entries on that side)
 *   - sum(DECREASE entries on that side)
 *
 * Positive = amount due to the business on that side.
 * Negative = credit / overpayment (shown explicitly, never clamped to zero).
 */
export type LedgerRowInput = {
  id: number;
  entryDate: string; // YYYY-MM-DD
  side: BalanceSide;
  direction: EntryDirection;
  amount: Money;
};

export type SideTotals = {
  increases: Money;
  decreases: Money;
};

export function signedDelta(direction: EntryDirection, amount: Money): Money {
  return direction === 'INCREASE' ? amount : amount.negated();
}

/** Net balance on one side from opening + entries (entries must already be filtered to that side). */
export function netBalance(opening: Money, openingSide: BalanceSide, side: BalanceSide, rows: LedgerRowInput[]): Money {
  let total = openingSide === side ? opening : ZERO;
  for (const row of rows) {
    if (row.side !== side) continue;
    total = total.plus(signedDelta(row.direction, row.amount));
  }
  return total;
}

export type AccountBalances = {
  receivable: Money;
  payable: Money;
};

/**
 * Both sides for one account. Callers normally display only the account's normal side,
 * but the other side is exposed so an unusual cross-side balance is never hidden.
 */
export function accountBalances(opening: Money, openingSide: BalanceSide, rows: LedgerRowInput[]): AccountBalances {
  return {
    receivable: netBalance(opening, openingSide, 'RECEIVABLE', rows),
    payable: netBalance(opening, openingSide, 'PAYABLE', rows),
  };
}

/** Sort: entry date ascending, then id ascending (deterministic, matches the database index). */
export function compareEntries(a: { entryDate: string; id: number }, b: { entryDate: string; id: number }): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
  return a.id - b.id;
}

export type StatementLine<T extends LedgerRowInput> = T & {
  runningBalance: Money;
  crossSide: boolean;
};

/**
 * Computes a running balance on the account's normal side for every entry, in ledger order.
 * Entries on the other side are flagged `crossSide` and excluded from the normal-side running balance
 * (they are reported explicitly instead).
 */
export function runningStatement<T extends LedgerRowInput>(
  opening: Money,
  openingSide: BalanceSide,
  normalSide: BalanceSide,
  rowsInOrder: T[],
): { lines: StatementLine<T>[]; closing: Money; openingOnNormalSide: Money } {
  let running = openingSide === normalSide ? opening : ZERO;
  const lines: StatementLine<T>[] = [];
  for (const row of rowsInOrder) {
    const crossSide = row.side !== normalSide;
    if (!crossSide) running = running.plus(signedDelta(row.direction, row.amount));
    lines.push({ ...row, runningBalance: running, crossSide });
  }
  return { lines, closing: running, openingOnNormalSide: openingSide === normalSide ? opening : ZERO };
}

/** Sums increases and decreases for the given rows (already filtered). */
export function sumDirections(rows: Array<{ direction: EntryDirection; amount: Money }>): SideTotals {
  let increases = ZERO;
  let decreases = ZERO;
  for (const row of rows) {
    if (row.direction === 'INCREASE') increases = increases.plus(row.amount);
    else decreases = decreases.plus(row.amount);
  }
  return { increases, decreases };
}

/** Balance wording for display and API: explicit about credits. */
export type BalanceStatus = 'DUE' | 'CREDIT' | 'SETTLED';

export function describeBalance(amount: Money): { status: BalanceStatus; absolute: string } {
  if (amount.isZero()) return { status: 'SETTLED', absolute: formatMoney(0) };
  if (amount.isNegative()) return { status: 'CREDIT', absolute: formatMoney(amount.abs()) };
  return { status: 'DUE', absolute: formatMoney(amount) };
}

export function toMoney(value: Prisma.Decimal | string | number | null | undefined): Money {
  return value === null || value === undefined ? ZERO : money(value);
}

export type SideAggregate = { side: BalanceSide; direction: EntryDirection; total: Money };

/**
 * Account balances from database aggregates (GROUP BY side, direction).
 * Used for list views and dashboards so we never load every ledger row just to show totals.
 */
export function balancesFromAggregates(opening: Money, openingSide: BalanceSide, aggregates: SideAggregate[]): AccountBalances {
  const pick = (side: BalanceSide): Money => {
    let total = openingSide === side ? opening : ZERO;
    for (const agg of aggregates) {
      if (agg.side !== side) continue;
      total = agg.direction === 'INCREASE' ? total.plus(agg.total) : total.minus(agg.total);
    }
    return total;
  };
  return { receivable: pick('RECEIVABLE'), payable: pick('PAYABLE') };
}
