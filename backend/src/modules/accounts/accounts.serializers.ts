import type { Account, AccountType } from '../../generated/prisma/client.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { describeBalance, type AccountBalances } from '../ledger/ledger.balance.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from '../ledger/ledger.rules.ts';
import { crossSideBalance, primaryBalance } from '../ledger/ledger.queries.ts';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CUSTOMER: 'Customer',
  SUPPLIER: 'Supplier',
};

export type BalanceInfo = { balances: AccountBalances; entryCount: number; lastEntryDate: string | null };

export function serializeAccount(account: Account, info?: BalanceInfo) {
  const normalSide = NORMAL_SIDE_BY_ACCOUNT_TYPE[account.type];
  const balances = info?.balances ?? {
    receivable: money(account.openingBalanceSide === 'RECEIVABLE' ? account.openingBalance : 0),
    payable: money(account.openingBalanceSide === 'PAYABLE' ? account.openingBalance : 0),
  };
  const primary: Money = primaryBalance(account.type, balances);
  const cross: Money = crossSideBalance(account.type, balances);
  const description = describeBalance(primary);
  return {
    id: account.id,
    accountCode: account.accountCode,
    name: account.name,
    type: account.type,
    typeLabel: ACCOUNT_TYPE_LABELS[account.type],
    phone: account.phone,
    email: account.email,
    address: account.address,
    notes: account.notes,
    openingBalance: formatMoney(account.openingBalance),
    openingBalanceSide: account.openingBalanceSide,
    normalSide,
    /** Balance on the account's normal side. Negative amounts are credits (advances / overpayments). */
    balance: {
      amount: formatMoney(primary),
      side: normalSide,
      status: description.status,
    },
    /** Both sides, always explicit so a cross-side balance is never hidden. */
    balances: {
      receivable: formatMoney(balances.receivable),
      payable: formatMoney(balances.payable),
    },
    crossSideBalance: cross.isZero() ? null : {
      amount: formatMoney(cross),
      side: normalSide === 'RECEIVABLE' ? 'PAYABLE' : 'RECEIVABLE',
      requiresCorrection: true,
    },
    isActive: account.isActive,
    entryCount: info?.entryCount ?? 0,
    lastEntryDate: info?.lastEntryDate ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export type SerializedAccount = ReturnType<typeof serializeAccount>;

export function accountCodeFor(type: AccountType, id: number): string {
  const prefix = type === 'CUSTOMER' ? 'CUS' : 'SUP';
  return `${prefix}-${String(id).padStart(6, '0')}`;
}
