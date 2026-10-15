import { prisma } from '../../db/prisma.ts';
import { errors } from '../../lib/errors.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { dbDateToIso } from '../../lib/dates.ts';
import { describeBalance, runningStatement, sumDirections, compareEntries, type LedgerRowInput, type StatementLine } from './ledger.balance.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE, PAYMENT_METHOD_LABELS, TYPE_LABELS } from './ledger.rules.ts';
import { serializeAccount } from '../accounts/accounts.serializers.ts';
import { loadBalances } from './ledger.queries.ts';
import type { BalanceSide, EntryDirection, PaymentMethod, TransactionType } from '../../generated/prisma/client.ts';
import type { LedgerQuery, StatementQuery } from './ledger.schemas.ts';

export type LedgerEntryRow = LedgerRowInput & {
  type: TransactionType;
  paymentMethod: PaymentMethod | null;
  referenceNumber: string | null;
  notes: string | null;
  reversalOfId: number | null;
  reversedById: number | null;
  createdAt: Date;
};

type LedgerLine = StatementLine<LedgerEntryRow>;

/** Serialized ledger entry for the API. Amounts are exact decimal strings. */
export function serializeEntry(line: LedgerLine) {
  const row = line;
  return {
    id: row.id,
    entryDate: row.entryDate,
    type: row.type,
    typeLabel: TYPE_LABELS[row.type],
    description: row.type === 'REVERSAL' && row.reversalOfId ? `Reversal of entry #${row.reversalOfId}` : TYPE_LABELS[row.type],
    side: row.side,
    direction: row.direction as EntryDirection,
    amount: formatMoney(row.amount),
    paymentMethod: row.paymentMethod,
    paymentMethodLabel: row.paymentMethod ? PAYMENT_METHOD_LABELS[row.paymentMethod] : null,
    referenceNumber: row.referenceNumber,
    notes: row.notes,
    reversalOfId: row.reversalOfId,
    reversedById: row.reversedById,
    isReversal: row.type === 'REVERSAL',
    isReversed: row.reversedById !== null,
    runningBalance: formatMoney(row.runningBalance),
    crossSide: row.crossSide,
    createdAt: row.createdAt.toISOString(),
  };
}

function matchesSearch(row: LedgerEntryRow, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [
    TYPE_LABELS[row.type],
    row.referenceNumber ?? '',
    row.notes ?? '',
    row.paymentMethod ? PAYMENT_METHOD_LABELS[row.paymentMethod] : '',
    String(row.id),
    formatMoney(row.amount),
  ].some((field) => field.toLowerCase().includes(needle));
}

export type LedgerFilters = { from?: string; to?: string; search?: string };

function balanceDto(amount: Money, side: BalanceSide) {
  const description = describeBalance(amount);
  return { amount: formatMoney(amount), side, status: description.status };
}

/**
 * Single computation shared by the paginated ledger, the statement and the CSV export.
 *  - Running balance is computed over ALL entries in (entryDate, id) order, so every row shows the true
 *    balance after it, regardless of the date or text filters applied to what is displayed.
 *  - Date and search filters choose which rows are displayed. Totals describe the displayed rows.
 *  - Balance brought forward = balance after the last entry before "from".
 *  - Closing balance = balance after the last entry on or before "to" (or the latest entry if no "to").
 */
async function computeLedger(accountId: number, filters: LedgerFilters) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw errors.notFound('Account not found.');

  const [entries, balanceInfo] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { accountId },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        entryDate: true,
        type: true,
        side: true,
        direction: true,
        amount: true,
        paymentMethod: true,
        referenceNumber: true,
        notes: true,
        reversalOfId: true,
        createdAt: true,
        reversedBy: { select: { id: true } },
      },
    }),
    loadBalances(prisma, [accountId]),
  ]);

  const rows: LedgerEntryRow[] = entries.map((entry) => ({
    id: entry.id,
    entryDate: dbDateToIso(entry.entryDate),
    side: entry.side as BalanceSide,
    direction: entry.direction,
    amount: money(entry.amount),
    type: entry.type,
    paymentMethod: entry.paymentMethod,
    referenceNumber: entry.referenceNumber,
    notes: entry.notes,
    reversalOfId: entry.reversalOfId,
    reversedById: entry.reversedBy?.id ?? null,
    createdAt: entry.createdAt,
  }));
  rows.sort(compareEntries);

  const normalSide = NORMAL_SIDE_BY_ACCOUNT_TYPE[account.type];
  const opening = money(account.openingBalance);
  const statement = runningStatement(opening, account.openingBalanceSide, normalSide, rows);

  let broughtForward = statement.openingOnNormalSide;
  if (filters.from) {
    for (const line of statement.lines) {
      if (line.entryDate < filters.from) broughtForward = line.runningBalance;
    }
  }
  let closing = statement.closing;
  if (filters.to) {
    closing = statement.openingOnNormalSide;
    for (const line of statement.lines) {
      if (line.entryDate <= filters.to) closing = line.runningBalance;
    }
  }

  const term = filters.search?.trim() ?? '';
  const displayed = statement.lines.filter((line) => {
    if (filters.from && line.entryDate < filters.from) return false;
    if (filters.to && line.entryDate > filters.to) return false;
    return matchesSearch(line, term);
  });

  // Totals use normal-side rows only; cross-side rows (should not exist) are counted separately.
  const totals = sumDirections(displayed.filter((line) => !line.crossSide));

  const summary = serializeAccount(account, balanceInfo.get(accountId));

  return {
    account: summary,
    filters: { from: filters.from ?? null, to: filters.to ?? null, search: term || null },
    openingBalance: { amount: formatMoney(opening), side: account.openingBalanceSide },
    balanceBroughtForward: balanceDto(broughtForward, normalSide),
    closingBalance: balanceDto(closing, normalSide),
    totals: {
      increases: formatMoney(totals.increases),
      decreases: formatMoney(totals.decreases),
      net: formatMoney(totals.increases.minus(totals.decreases)),
      entryCount: displayed.length,
    },
    crossSideEntryCount: displayed.filter((line) => line.crossSide).length,
    displayed,
  };
}

export async function getLedgerPage(accountId: number, query: LedgerQuery) {
  const view = await computeLedger(accountId, { from: query.from, to: query.to, search: query.search });
  const { displayed, ...rest } = view;
  const total = displayed.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    ...rest,
    entries: displayed.slice(start, start + query.pageSize).map(serializeEntry),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    order: 'oldest_first' as const,
  };
}

export async function getStatement(accountId: number, query: StatementQuery) {
  const view = await computeLedger(accountId, { from: query.from, to: query.to, search: query.search });
  const { displayed, ...rest } = view;
  return { ...rest, entries: displayed.map(serializeEntry), order: 'oldest_first' as const };
}

/** RFC 4180 CSV cell. Free-text cells are protected against spreadsheet formula injection. */
export function csvCell(value: string | number | null | undefined, options: { textual?: boolean } = {}): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (options.textual && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function getLedgerCsv(accountId: number, query: StatementQuery): Promise<{ filename: string; body: string }> {
  const view = await computeLedger(accountId, { from: query.from, to: query.to, search: query.search });
  const header = ['Entry ID', 'Date', 'Description', 'Reference', 'Payment method', 'Notes', 'Increase', 'Decrease', 'Running balance', 'Reversed'];
  const lines: string[] = [header.map((h) => csvCell(h)).join(',')];
  for (const line of view.displayed) {
    lines.push(
      [
        csvCell(line.id),
        csvCell(line.entryDate),
        csvCell(TYPE_LABELS[line.type], { textual: true }),
        csvCell(line.referenceNumber, { textual: true }),
        csvCell(line.paymentMethod ? PAYMENT_METHOD_LABELS[line.paymentMethod] : '', { textual: true }),
        csvCell(line.notes, { textual: true }),
        csvCell(line.direction === 'INCREASE' ? formatMoney(line.amount) : ''),
        csvCell(line.direction === 'DECREASE' ? formatMoney(line.amount) : ''),
        csvCell(formatMoney(line.runningBalance)),
        csvCell(line.reversedById !== null ? 'Yes' : 'No'),
      ].join(','),
    );
  }
  const safeCode = view.account.accountCode.replace(/[^A-Za-z0-9-]/g, '');
  const stamp = `${view.filters.from ?? 'start'}_to_${view.filters.to ?? 'latest'}`;
  return { filename: `ledger-${safeCode}-${stamp}.csv`, body: `\uFEFF${lines.join('\r\n')}\r\n` };
}
