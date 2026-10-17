// Shapes returned by the API. Money is always a decimal string (e.g. "1500.00"); never parse it with floats for math.

export type AccountType = 'CUSTOMER' | 'SUPPLIER';
export type UserRole = 'ADMIN' | 'USER';
export type BalanceSide = 'RECEIVABLE' | 'PAYABLE';
export type EntryDirection = 'INCREASE' | 'DECREASE';
export type BalanceStatus = 'DUE' | 'CREDIT' | 'SETTLED';
export type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'OTHER';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * The server returns DEPOSIT / WITHDRAWAL (REVERSAL marks offsetting entries).
 * The legacy credit-ledger names are kept for form values and old clients and are
 * mapped to the two kinds by the API layer.
 */
export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'REVERSAL'
  | 'CREDIT_SALE'
  | 'PAYMENT_RECEIVED'
  | 'CUSTOMER_CREDIT_ADJUSTMENT'
  | 'CREDIT_PURCHASE'
  | 'PAYMENT_MADE'
  | 'SUPPLIER_CREDIT_ADJUSTMENT';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  accountId: number | null;
  name: string;
}

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
  username: string | null;
  hasLogin: boolean;
  type: AccountType;
  typeLabel: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  openingBalance: string;
  openingBalanceSide: BalanceSide;
  normalSide: BalanceSide;
  totalCredited?: string;
  totalPaid?: string;
  totalUserPaid: string;
  totalAdminPaid: string;
  pendingBalance: string;
  pendingSubmissionsCount?: number;
  pendingSubmissionsAmount?: string;
  balance: Balance;
  balances: { receivable: string; payable: string };
  crossSideBalance: { amount: string; side: BalanceSide } | null;
  isActive: boolean;
  entryCount: number;
  lastEntryDate: string | null;
  hasPin?: boolean;
  allowedBookIds?: number[];
  backDateAllowedDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: number;
  entryDate: string;
  type: TransactionType;
  typeLabel: string;
  description: string;
  detail?: string | null;
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
  approvalStatus?: ApprovalStatus;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  runningBalance: string;
  crossSide: boolean;
  createdAt: string;
  bookId?: number | null;
  bookName?: string | null;
  staffName?: string | null;
  customerId?: string | null;
  bankDetails?: string | null;
  option?: string | null;
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
  option?: string | null;
  detail?: string | null;
  bookId?: number | null;
  bookName?: string | null;
  customerId?: string | null;
  bankDetails?: string | null;
  description?: string | null;
  paymentMethod: PaymentMethod | null;
  paymentMethodLabel: string | null;
  referenceNumber: string | null;
  notes: string | null;
  reversalOfId: number | null;
  reversedById: number | null;
  isReversal: boolean;
  isReversed: boolean;
  approvalStatus?: ApprovalStatus;
  reviewedBy?: { id: number; username: string } | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  account: { id: number; accountCode: string; name: string; type: AccountType; typeLabel: string };
  createdById: number;
  createdAt: string;
}

export interface DashboardUserOverview {
  id: number;
  accountCode: string;
  name: string;
  username: string | null;
  phone: string | null;
  type: AccountType;
  isActive: boolean;
  totalUserPaid: string;
  totalAdminPaid: string;
  pendingBalance: string;
  pendingSubmissionsCount?: number;
  pendingSubmissionsAmount?: string;
  balance: Balance;
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
    totalUsers: number;
    activeUsers: number;
    ledgerEntries: number;
    entriesToday: number;
    customersWithBalance: number;
    suppliersWithBalance: number;
    pendingSubmissionsCount?: number;
    activeBooks?: number;
  };
  userLedgerTotals: {
    totalUserPaid: string;
    totalAdminPaid: string;
    totalPending: string;
    pendingSubmissionsCount?: number;
    pendingSubmissionsAmount?: string;
    todayUserPaid: string;
    todayUserPaidCount: number;
    todayAdminPaid: string;
    todayAdminPaidCount: number;
  };
  receivables: { total: string; credits: string; description: string };
  payables: { total: string; credits: string; description: string };
  todayPayments: { received: string; receivedCount: number; paid: string; paidCount: number; date: string };
  pendingEntries?: Transaction[];
  recentTransactions: Transaction[];
  outstandingAccounts: Array<{
    id: number;
    accountCode: string;
    name: string;
    username?: string | null;
    type: AccountType;
    isActive: boolean;
    totalUserPaid?: string;
    totalAdminPaid?: string;
    pendingBalance?: string;
    balance: Balance;
  }>;
  usersOverview: DashboardUserOverview[];
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
    logoUrl?: string | null;
    userEntryOptions?: string[];
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
  entityId: string | null;
  actor: string | null;
  details: unknown;
  createdAt: string;
}

export interface BookSummary {
  id: number;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED' | string;
  entryCount?: number;
}

export interface AccountOption {
  id: number;
  accountCode: string;
  name: string;
  username?: string | null;
  type: AccountType;
  isActive: boolean;
  totalUserPaid?: string;
  totalAdminPaid?: string;
  pendingBalance?: string;
  balance: Balance;
}
