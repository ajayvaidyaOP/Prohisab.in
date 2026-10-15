import type { AccountType, BalanceSide, EntryDirection, PaymentMethod, TransactionType } from '../../generated/prisma/client.ts';

/**
 * Single source of truth for how each transaction type posts to the ledger.
 * The client only sends the transaction type; side, direction and the allowed account type are
 * derived here on the server (and mirrored by database triggers in the safeguards migration).
 */
export type PostingRule = {
  accountType: AccountType;
  side: BalanceSide;
  direction: EntryDirection;
  requiresPaymentMethod: boolean;
  label: string;
  description: string;
};

export const TRANSACTION_RULES: Record<Exclude<TransactionType, 'REVERSAL'>, PostingRule> = {
  CREDIT_SALE: {
    accountType: 'CUSTOMER',
    side: 'RECEIVABLE',
    direction: 'INCREASE',
    requiresPaymentMethod: false,
    label: 'Credit sale / amount due',
    description: 'Customer owes the business more (increases receivable).',
  },
  PAYMENT_RECEIVED: {
    accountType: 'CUSTOMER',
    side: 'RECEIVABLE',
    direction: 'DECREASE',
    requiresPaymentMethod: true,
    label: 'Payment received',
    description: 'Customer paid the business (decreases receivable).',
  },
  CUSTOMER_CREDIT_ADJUSTMENT: {
    accountType: 'CUSTOMER',
    side: 'RECEIVABLE',
    direction: 'DECREASE',
    requiresPaymentMethod: false,
    label: 'Credit / refund adjustment',
    description: 'Credit note or refund given to the customer (decreases receivable).',
  },
  CREDIT_PURCHASE: {
    accountType: 'SUPPLIER',
    side: 'PAYABLE',
    direction: 'INCREASE',
    requiresPaymentMethod: false,
    label: 'Credit purchase / amount owed',
    description: 'Business owes the supplier more (increases payable).',
  },
  PAYMENT_MADE: {
    accountType: 'SUPPLIER',
    side: 'PAYABLE',
    direction: 'DECREASE',
    requiresPaymentMethod: true,
    label: 'Payment made',
    description: 'Business paid the supplier (decreases payable).',
  },
  SUPPLIER_CREDIT_ADJUSTMENT: {
    accountType: 'SUPPLIER',
    side: 'PAYABLE',
    direction: 'DECREASE',
    requiresPaymentMethod: false,
    label: 'Credit / return adjustment',
    description: 'Supplier credit note or goods returned (decreases payable).',
  },
};

export const USER_TRANSACTION_TYPES = Object.keys(TRANSACTION_RULES) as Array<keyof typeof TRANSACTION_RULES>;

/** The normal (expected) ledger side for each account type. */
export const NORMAL_SIDE_BY_ACCOUNT_TYPE: Record<AccountType, BalanceSide> = {
  CUSTOMER: 'RECEIVABLE',
  SUPPLIER: 'PAYABLE',
};

export const TYPE_LABELS: Record<TransactionType, string> = {
  CREDIT_SALE: TRANSACTION_RULES.CREDIT_SALE.label,
  PAYMENT_RECEIVED: TRANSACTION_RULES.PAYMENT_RECEIVED.label,
  CUSTOMER_CREDIT_ADJUSTMENT: TRANSACTION_RULES.CUSTOMER_CREDIT_ADJUSTMENT.label,
  CREDIT_PURCHASE: TRANSACTION_RULES.CREDIT_PURCHASE.label,
  PAYMENT_MADE: TRANSACTION_RULES.PAYMENT_MADE.label,
  SUPPLIER_CREDIT_ADJUSTMENT: TRANSACTION_RULES.SUPPLIER_CREDIT_ADJUSTMENT.label,
  REVERSAL: 'Reversal',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};

export function isUserTransactionType(value: string): value is keyof typeof TRANSACTION_RULES {
  return Object.prototype.hasOwnProperty.call(TRANSACTION_RULES, value);
}

/** Returns true when a client-supplied side/direction pair matches the server rule (for explicit checks). */
export function matchesRule(type: keyof typeof TRANSACTION_RULES, side: BalanceSide, direction: EntryDirection): boolean {
  const rule = TRANSACTION_RULES[type];
  return rule.side === side && rule.direction === direction;
}
