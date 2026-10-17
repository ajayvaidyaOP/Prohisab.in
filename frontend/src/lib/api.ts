import type {
  AccountOption,
  AccountSummary,
  AuditItem,
  AuthUser,
  BookSummary,
  DashboardData,
  LedgerResponse,
  Pagination,
  SettingsView,
  StatementResponse,
  Transaction,
} from './types';

/** Error thrown for every non-2xx response. Message is safe to show to the user. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Array<{ field?: string; message: string }>;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: Array<{ field?: string; message: string }>, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level message from the server, if any. */
  fieldError(field: string): string | undefined {
    return this.details?.find((d) => d.field === field)?.message;
  }
}

export const SESSION_EXPIRED_EVENT = 'erp:session-expired';
// Authentication is cookie-only: the server sets an HttpOnly session cookie and the
// browser sends it automatically. No token is ever stored in JavaScript.

type Query = Record<string, string | number | boolean | null | undefined>;

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  const prefix = API_BASE_URL
    ? API_BASE_URL.endsWith('/api')
      ? API_BASE_URL
      : `${API_BASE_URL}/api`
    : '/api';
  return `${prefix}${path}${qs ? `?${qs}` : ''}`;
}

interface RequestOptions {
  body?: unknown;
  query?: Query;
  idempotencyKey?: string;
  raw?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: API_BASE_URL ? 'include' : 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'We could not reach the server. Check your connection and try again.');
  }

  if (response.status === 401 && !['/auth/login', '/auth/pin-login', '/auth/me'].includes(path)) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  if (options.raw) {
    if (!response.ok) throw new ApiError(response.status, 'REQUEST_FAILED', 'The file could not be downloaded.');
    return (await response.text()) as T;
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? friendlyStatusMessage(response.status),
      error?.details,
      error?.requestId,
    );
  }
  return data as T;
}

function friendlyStatusMessage(status: number): string {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on the server. Please try again.';
  return 'The request could not be completed.';
}

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, { body, idempotencyKey });
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body });
const patch = <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('PATCH', path, { body, idempotencyKey });

/**
 * Maps the UI's transaction payload onto the server contract:
 * - legacy type names collapse into DEPOSIT / WITHDRAWAL
 * - `optionName` accepts `option`, and `detail` accepts `description`
 */
function mapTransactionInput(body: Record<string, unknown>): Record<string, unknown> {
  const type = String(body.type ?? '').toUpperCase();
  const DEPOSIT_TYPES = new Set(['DEPOSIT', 'CREDIT_SALE', 'CREDIT_PURCHASE', 'INCREASE']);
  const mappedType = DEPOSIT_TYPES.has(type) ? 'DEPOSIT' : 'WITHDRAWAL';
  const optionName = body.optionName ?? body.option;
  const detail = body.detail ?? body.description;
  return {
    ...body,
    type: mappedType,
    optionName: optionName ?? null,
    detail: detail ?? null,
  };
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      post<{ user: AuthUser }>('/auth/login', { username, password }),
    pinLogin: (pin: string) =>
      post<{ user: AuthUser }>('/auth/pin-login', { pin }),
    changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      post<void>('/auth/change-password', body),
    logout: () => post<void>('/auth/logout'),
    me: () => get<{ user: AuthUser }>('/auth/me'),
  },
  accounts: {
    list: (params: { search?: string; type?: string; status?: string; sort?: string; page?: number; pageSize?: number }) =>
      get<{ items: AccountSummary[]; pagination: Pagination }>('/accounts', params),
    options: (params: { search?: string; type?: string }) => get<{ items: AccountOption[] }>('/accounts/options', params),
    get: (id: number) => get<{ account: AccountSummary }>(`/accounts/${id}`),
    create: (body: unknown, idempotencyKey: string) => post<{ account: AccountSummary; replayed: boolean }>('/accounts', body, idempotencyKey),
    update: (id: number, body: unknown) => patch<{ account: AccountSummary }>(`/accounts/${id}`, body),
    setStatus: (id: number, isActive: boolean) => patch<{ account: AccountSummary }>(`/accounts/${id}/status`, { isActive }),
    setBackDate: (id: number, date: string | null) => patch<{ account: AccountSummary }>(`/accounts/${id}/back-date`, { date }),
    setPin: (id: number, pin: string | null) => put<{ account: AccountSummary }>(`/accounts/${id}/pin`, { pin }),
    setBooks: (id: number, bookIds: number[]) => put<{ account: AccountSummary }>(`/accounts/${id}/books`, bookIds),
    resetPassword: (id: number, body: { newPassword: string; confirmPassword: string }) =>
      post<void>(`/accounts/${id}/reset-password`, body),
  },
  ledger: {
    page: (id: number, params: { from?: string; to?: string; search?: string; page?: number; pageSize?: number }) =>
      get<LedgerResponse>(`/accounts/${id}/ledger`, params),
    statement: (id: number, params: { from?: string; to?: string; search?: string }) =>
      get<StatementResponse>(`/accounts/${id}/statement`, params),
    csvUrl: (id: number, params: { from?: string; to?: string; search?: string }) => buildUrl(`/accounts/${id}/ledger.csv`, params),
    pdfUrl: (id: number, params: { from?: string; to?: string; search?: string }) => buildUrl(`/accounts/${id}/ledger.pdf`, params),
    downloadPdf: async (id: number, accountName?: string, params: { from?: string; to?: string; search?: string } = {}) => {
      const headers: Record<string, string> = {
        Accept: 'application/pdf',
        'X-Requested-With': 'XMLHttpRequest',
      };
      const response = await fetch(buildUrl(`/accounts/${id}/ledger.pdf`, params), {
        method: 'GET',
        headers,
        credentials: API_BASE_URL ? 'include' : 'same-origin',
      });
      if (!response.ok) {
        throw new ApiError(response.status, 'PDF_DOWNLOAD_FAILED', 'Could not download the PDF ledger.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (accountName || `user-${id}`).replace(/[^A-Za-z0-9_-]/g, '_');
      const suffix = params.from && params.to ? `-${params.from}_to_${params.to}` : '';
      a.href = url;
      a.download = `ledger-${safeName}${suffix}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    downloadAllUsersSummaryPdf: async (params: { from?: string; to?: string; bookId?: number; userId?: number } = {}) => {
      const headers: Record<string, string> = {
        Accept: 'application/pdf',
        'X-Requested-With': 'XMLHttpRequest',
      };
      const response = await fetch(buildUrl('/dashboard/summary.pdf', params), {
        method: 'GET',
        headers,
        credentials: API_BASE_URL ? 'include' : 'same-origin',
      });
      if (!response.ok) {
        throw new ApiError(response.status, 'PDF_DOWNLOAD_FAILED', 'Could not download All Users Summary PDF.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all-users-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
  },
  books: {
    list: () => get<BookSummary[]>('/books'),
    create: (name: string) => post<BookSummary>('/books', { name }),
    archive: (id: number) => post<BookSummary>(`/books/${id}/archive`, {}),
    restore: (id: number) => post<BookSummary>(`/books/${id}/restore`, {}),
  },
  transactions: {
    list: (params: {
      search?: string;
      type?: string;
      approvalStatus?: string;
      accountId?: number;
      from?: string;
      to?: string;
      includeReversals?: boolean;
      page?: number;
      pageSize?: number;
    }) =>
      get<{ items: Transaction[]; pagination: Pagination }>('/transactions', {
        ...params,
        includeReversals: params.includeReversals === false ? 'false' : undefined,
      }),
    multiReport: (userIds: number[] | null, from?: string, to?: string, bookId?: number) =>
      get<Transaction[]>(`/transactions/multi-report`, { userIds: userIds?.length ? userIds.join(',') : undefined, from, to, bookId }),
    downloadMultiReportPdf: async (userIds: number[] | null, from?: string, to?: string, bookId?: number) => {
      const params = { userIds: userIds?.length ? userIds.join(',') : undefined, from, to, bookId };
      const response = await fetch(buildUrl('/transactions/multi-report.pdf', params), {
        method: 'GET',
        headers: { Accept: 'application/pdf', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: API_BASE_URL ? 'include' : 'same-origin',
      });
      if (!response.ok) throw new ApiError(response.status, 'PDF_DOWNLOAD_FAILED', 'Could not download the multi-user history PDF.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `multi-user-history-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    create: (body: Record<string, unknown>, idempotencyKey: string) =>
      post<{ transaction: Transaction; account: AccountSummary; replayed: boolean }>(
        '/transactions',
        mapTransactionInput(body),
        idempotencyKey,
      ),
    update: (id: number, body: Record<string, unknown>, idempotencyKey: string) =>
      patch<{ transaction: Transaction; account: AccountSummary; replayed: boolean }>(
        `/transactions/${id}`,
        mapTransactionInput(body),
        idempotencyKey,
      ),
    approve: (id: number, idempotencyKey: string) =>
      post<{ transaction: Transaction; account: AccountSummary; alreadyApproved?: boolean; replayed: boolean }>(
        `/transactions/${id}/approve`,
        {},
        idempotencyKey,
      ),
    reject: (id: number, body: { reason: string }, idempotencyKey: string) =>
      post<{ transaction: Transaction; account: AccountSummary; alreadyRejected?: boolean; replayed: boolean }>(
        `/transactions/${id}/reject`,
        body,
        idempotencyKey,
      ),
    reverse: (id: number, body: { reason: string; entryDate?: string }, idempotencyKey: string) =>
      post<{ reversal: Transaction; original: { id: number; isReversed: boolean; reversedById: number }; account: AccountSummary; replayed: boolean }>(
        `/transactions/${id}/reversal`,
        body,
        idempotencyKey,
      ),
  },
  dashboard: (params: { from?: string; to?: string; bookId?: number; userId?: number } = {}) =>
    get<DashboardData>('/dashboard', params),
  settings: {
    get: () => get<SettingsView>('/settings'),
    update: (body: unknown) => put<{ business: SettingsView['business']; today: string }>('/settings', body),
    updateEntryOptions: (options: string[]) =>
      put<{ business: SettingsView['business']; userEntryOptions: string[] }>('/settings/entry-options', { options }),
  },
  audit: (params: { page?: number; pageSize?: number; entityType?: string }) =>
    get<{ items: AuditItem[]; pagination: Pagination }>('/audit-logs', params),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
