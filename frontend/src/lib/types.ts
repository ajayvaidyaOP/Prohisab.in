// Shapes returned by the API. Money is always a decimal string (e.g. "1500.00"); never parse it with floats for math.

export type AccountType = 'CUSTOMER' | 'SUPPLIER';
export type BalanceSide = 'RECEIVABLE' | 'PAYABLE';
export type EntryDirection = 'INCREASE' | 'DECREASE';
export type BalanceStatus = 'DUE' | 'CREDIT' | 'SETTLED';
export type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'OTHER';

export type TransactionType =
  | 'CREDIT_SALE'
  | 'PAYMENT_RECEIVED'
  | 'CUSTOMER_CREDIT_ADJUSTMENT'
  | 'CREDIT_PURCHASE'
  | 'PAYMENT_MADE'
  | 'SUPPLIER_CREDIT_ADJUSTMENT'
  | 'REVERSAL';

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Balance {
  amount: string;
  side: BalanceSide;
  status: BalanceStatus;
}

export interface AccountSummary {
  id: number;
  accountCode: string;
  name: string;
  type: AccountType;
  typeLabel: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  openingBalance: string;
  openingBalanceSide: BalanceSide;
  normalSide: BalanceSide;
  balance: Balance;
  balances: { receivable: string; payable: string };
  crossSideBalance: { amount: string; side: BalanceSide } | null;
  isActive: boolean;
  entryCount: number;
  lastEntryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: number;
  entryDate: string;
  type: TransactionType;
  typeLabel: string;
  description: string;
  side: BalanceSide;
  direction: EntryDirection;
  amount: string;
  paymentMethod: PaymentMethod | null;
  paymentMethodLabel: string | null;
  referenceNumber: string | null;
  notes: string | null;
  reversalOfId: number | null;
  reversedById: number | null;
  isReversal: boolean;
  isReversed: boolean;
  runningBalance: string;
  crossSide: boolean;
  createdAt: string;
}

export interface LedgerResponse {
  account: AccountSummary;
  filters: { from: string | null; to: string | null; search: string | null };
  openingBalance: { amount: string; side: BalanceSide };
  balanceBroughtForward: Balance;
  closingBalance: Balance;
  totals: { increases: string; decreases: string; net: string; entryCount: number };
  crossSideEntryCount: number;
  entries: LedgerEntry[];
  pagination: Pagination;
}

export interface StatementResponse extends Omit<LedgerResponse, 'pagination'> {
  entries: LedgerEntry[];
}

export interface Transaction {
  id: number;
  entryDate: string;
  type: TransactionType;
  typeLabel: string;
  side: BalanceSide;
  direction: EntryDirection;
  amount: string;
  paymentMethod: PaymentMethod | null;
  paymentMethodLabel: string | null;
  referenceNumber: string | null;
  notes: string | null;
  reversalOfId: number | null;
  reversedById: number | null;
  isReversal: boolean;
  isReversed: boolean;
  account: { id: number; accountCode: string; name: string; type: AccountType; typeLabel: string };
  createdById: number;
  createdAt: string;
}

export interface DashboardData {
  today: string;
  timezone: string;
  currencySymbol: string;
  counts: {
    activeCustomers: number;
    inactiveCustomers: number;
    activeSuppliers: number;
    inactiveSuppliers: number;
    ledgerEntries: number;
    entriesToday: number;
    customersWithBalance: number;
    suppliersWithBalance: number;
  };
  receivables: { total: string; credits: string; description: string };
  payables: { total: string; credits: string; description: string };
  todayPayments: { received: string; receivedCount: number; paid: string; paidCount: number; date: string };
  recentTransactions: Transaction[];
  outstandingAccounts: Array<{
    id: number;
    accountCode: string;
    name: string;
    type: AccountType;
    isActive: boolean;
    balance: Balance;
  }>;
  outstandingCount: number;
}

export interface SettingsView {
  business: {
    businessName: string;
    businessAddress: string | null;
    businessPhone: string | null;
    businessEmail: string | null;
    currencySymbol: string;
    timezone: string;
    updatedAt: string;
  };
  today: string;
  user: { username: string };
  session: { idleTimeoutMinutes: number; maxSessionHours: number };
}

export interface AuditItem {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  actor: string | null;
  details: unknown;
  createdAt: string;
}

export interface AccountOption {
  id: number;
  accountCode: string;
  name: string;
  type: AccountType;
  isActive: boolean;
  balance: Balance;
}
