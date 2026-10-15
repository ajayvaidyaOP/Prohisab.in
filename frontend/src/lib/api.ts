import type {
  AccountOption,
  AccountSummary,
  AuditItem,
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

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
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
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'We could not reach the server. Check your connection and try again.');
  }

  if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
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
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body });

export const api = {
  auth: {
    login: (username: string, password: string) => post<{ user: { id: number; username: string } }>('/auth/login', { username, password }),
    logout: () => post<void>('/auth/logout'),
    me: () => get<{ user: { id: number; username: string } }>('/auth/me'),
  },
  accounts: {
    list: (params: { search?: string; type?: string; status?: string; sort?: string; page?: number; pageSize?: number }) =>
      get<{ items: AccountSummary[]; pagination: Pagination }>('/accounts', params),
    options: (params: { search?: string; type?: string }) => get<{ items: AccountOption[] }>('/accounts/options', params),
    get: (id: number) => get<{ account: AccountSummary }>(`/accounts/${id}`),
    create: (body: unknown, idempotencyKey: string) => post<{ account: AccountSummary; replayed: boolean }>('/accounts', body, idempotencyKey),
    update: (id: number, body: unknown) => patch<{ account: AccountSummary }>(`/accounts/${id}`, body),
    setStatus: (id: number, isActive: boolean) => patch<{ account: AccountSummary }>(`/accounts/${id}/status`, { isActive }),
  },
  ledger: {
    page: (id: number, params: { from?: string; to?: string; search?: string; page?: number; pageSize?: number }) =>
      get<LedgerResponse>(`/accounts/${id}/ledger`, params),
    statement: (id: number, params: { from?: string; to?: string; search?: string }) =>
      get<StatementResponse>(`/accounts/${id}/statement`, params),
    csvUrl: (id: number, params: { from?: string; to?: string; search?: string }) => buildUrl(`/accounts/${id}/ledger.csv`, params),
  },
  transactions: {
    list: (params: {
      search?: string;
      type?: string;
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
    create: (body: unknown, idempotencyKey: string) =>
      post<{ transaction: Transaction; account: AccountSummary; replayed: boolean }>('/transactions', body, idempotencyKey),
    reverse: (id: number, body: { reason: string; entryDate?: string }, idempotencyKey: string) =>
      post<{ reversal: Transaction; original: { id: number; isReversed: boolean; reversedById: number }; account: AccountSummary; replayed: boolean }>(
        `/transactions/${id}/reversal`,
        body,
        idempotencyKey,
      ),
  },
  dashboard: () => get<DashboardData>('/dashboard'),
  settings: {
    get: () => get<SettingsView>('/settings'),
    update: (body: unknown) => put<{ business: SettingsView['business']; today: string }>('/settings', body),
    changePassword: (currentPassword: string, newPassword: string) => post<void>('/settings/password', { currentPassword, newPassword }),
  },
  audit: (params: { page?: number; pageSize?: number; entityType?: string }) =>
    get<{ items: AuditItem[]; pagination: Pagination }>('/audit-logs', params),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
