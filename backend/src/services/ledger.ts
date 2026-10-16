import type { Transaction } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { dbDateToIso, isoDateToDbDate } from '../lib/dates.ts';
import { errors } from '../lib/errors.ts';
import { formatMoney, money, ZERO } from '../lib/money.ts';
import { dateRange, num, textParam } from '../lib/validation.ts';
import type { Actor } from '../middleware/auth.ts';
import { describeBalance, summary } from './accounts.ts';
import { descriptionOf } from './transactions.ts';

function ledgerView(row: Transaction, running: ReturnType<typeof money>) {
  const isReversal = row.reversalOfId !== null;
  const description = descriptionOf(row);
  return {
    id: num(row.id)!, entryDate: dbDateToIso(row.entryDate),
    type: isReversal ? 'REVERSAL' : row.kind,
    typeLabel: isReversal ? 'Reversal' : row.kind === 'DEPOSIT' ? 'Deposit' : 'Withdrawal',
    description, option: row.optionName, detail: row.detail,
    side: 'RECEIVABLE' as const, direction: row.kind === 'DEPOSIT' ? 'INCREASE' as const : 'DECREASE' as const,
    amount: formatMoney(row.amount), paymentMethod: row.paymentMethod,
    paymentMethodLabel: row.paymentMethod ?? row.optionName, referenceNumber: row.referenceNumber,
    notes: description, reversalOfId: num(row.reversalOfId), reversedById: num(row.reversedById),
    isReversal, isReversed: row.reversedById !== null, approvalStatus: row.approvalStatus,
    reviewedAt: row.reviewedAt?.toISOString() ?? null, rejectionReason: row.rejectionReason,
    runningBalance: formatMoney(running), crossSide: false, createdAt: row.createdAt.toISOString(),
  };
}

export async function getLedger(userId: bigint, query: Record<string, unknown>, viewer: Actor) {
  if (viewer.role !== 'ADMIN' && viewer.id !== userId) throw errors.forbidden('You can only view your own account.');
  const range = dateRange(query);
  const search = textParam(query.search)?.slice(0, 150) ?? null;
  const account = await summary(prisma, userId);
  const priorRows = range.from ? await prisma.transaction.groupBy({ by: ['kind'],
    where: { userId, approvalStatus: 'APPROVED', entryDate: { lt: isoDateToDbDate(range.from) } },
    _sum: { amount: true } }) : [];
  let brought = ZERO;
  for (const prior of priorRows) {
    brought = prior.kind === 'DEPOSIT' ? brought.plus(prior._sum.amount ?? '0') : brought.minus(prior._sum.amount ?? '0');
  }
  const rows = await prisma.transaction.findMany({ where: {
    userId, ...(range.where ? { entryDate: range.where } : {}),
  }, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], take: 20_001 });
  if (rows.length > 20_000) throw errors.badRequest('Too many ledger entries. Narrow the date range.');
  let running = money(brought), increases = ZERO, decreases = ZERO, entryCount = 0;
  const all = rows.map((row) => {
    if (row.approvalStatus === 'APPROVED') {
      if (row.kind === 'DEPOSIT') { increases = increases.plus(row.amount); running = running.plus(row.amount); }
      else { decreases = decreases.plus(row.amount); running = running.minus(row.amount); }
      entryCount++;
    }
    return ledgerView(row, running);
  });
  const entries = search ? all.filter((row) => row.description.toLowerCase().includes(search.toLowerCase()) ||
    (row.referenceNumber ?? '').toLowerCase().includes(search.toLowerCase())) : all;
  return {
    account, filters: { from: range.from ?? null, to: range.to ?? null, search },
    openingBalance: { amount: '0.00', side: 'RECEIVABLE' as const },
    balanceBroughtForward: describeBalance(brought), closingBalance: describeBalance(running),
    totals: { increases: formatMoney(increases), decreases: formatMoney(decreases),
      net: formatMoney(increases.minus(decreases)), entryCount },
    crossSideEntryCount: 0, entries,
  };
}

export function csvCell(value: unknown, untrusted = true): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  // Spreadsheet formula injection: protect user-entered fields, not signed money values.
  const safe = untrusted && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function ledgerCsv(data: Awaited<ReturnType<typeof getLedger>>): string {
  const lines = ['Date,Type,Option,Detail,Amount,Status,Balance'];
  for (const row of data.entries) {
    lines.push([row.entryDate, row.typeLabel, row.option, row.detail, row.amount, row.approvalStatus,
      row.runningBalance].map((value, index) => csvCell(value, index === 2 || index === 3)).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
