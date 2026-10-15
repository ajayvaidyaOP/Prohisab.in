import 'dotenv/config';

/**
 * Integration test helpers. These run the real Express app against a real MySQL database.
 *
 * The database must have the migrations applied (`prisma migrate deploy` or the migration SQL), and its
 * name must contain "test" so that a developer database is never used by mistake.
 *
 *   TEST_DATABASE_URL="mysql://erp_app:PASSWORD@localhost:3306/erp_ledger_test" npm run test:integration
 */
/**
 * Uses TEST_DATABASE_URL when set. Otherwise it takes DATABASE_URL from backend/.env and appends "_test"
 * to the database name (erp_ledger -> erp_ledger_test). No credentials are stored in this file.
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    throw new Error('Set TEST_DATABASE_URL (a MySQL database whose name contains "test") or DATABASE_URL in backend/.env.');
  }
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}
const TEST_URL = testDatabaseUrl();

if (!/\/[A-Za-z0-9_]*test[A-Za-z0-9_]*$/.test(new URL(TEST_URL).pathname)) {
  throw new Error('TEST_DATABASE_URL must point to a database whose name contains "test".');
}
process.env.DATABASE_URL = TEST_URL;
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';

export const ADMIN = { username: 'testadmin', password: 'TestAdminPass-2026' };
export const RUN = Date.now().toString(36);

export type ApiResponse = { status: number; body: any; headers: Headers; setCookie: string | null };

export class Api {
  cookie = '';
  constructor(private readonly base: string) {}

  async call(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; cookie?: string } = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', ...(options.headers ?? {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = options.cookie ?? this.cookie;
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON response (e.g. CSV) */
    }
    return { status: res.status, body, headers: res.headers, setCookie: res.headers.get('set-cookie') };
  }

  async login(username = ADMIN.username, password = ADMIN.password): Promise<ApiResponse> {
    const res = await this.call('POST', '/api/auth/login', { body: { username, password } });
    const match = res.setCookie?.match(/erp_session=([^;]+)/);
    if (res.status === 200 && match) this.cookie = `erp_session=${match[1]}`;
    return res;
  }

  get(path: string) {
    return this.call('GET', path);
  }
  post(path: string, body?: unknown, key?: string) {
    return this.call('POST', path, { body, headers: key ? { 'Idempotency-Key': key } : {} });
  }
  patch(path: string, body?: unknown) {
    return this.call('PATCH', path, { body });
  }
  put(path: string, body?: unknown) {
    return this.call('PUT', path, { body });
  }
}

export async function bootApp() {
  const { createApp } = await import('../../src/app.ts');
  const { prisma } = await import('../../src/db/prisma.ts');
  const { hashPassword } = await import('../../src/lib/password.ts');

  // Make sure the test admin exists with a known password (idempotent across runs).
  const passwordHash = await hashPassword(ADMIN.password);
  const existing = await prisma.adminUser.findUnique({ where: { username: ADMIN.username } });
  if (existing) await prisma.adminUser.update({ where: { id: existing.id }, data: { passwordHash } });
  else await prisma.adminUser.create({ data: { username: ADMIN.username, passwordHash } });

  const app = createApp();
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return {
    baseUrl: base,
    api: () => new Api(base),
    prisma,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    },
  };
}

/** Pull the human-readable message out of a Prisma/driver error (including MySQL SIGNAL text). */
export function dbErrorMessage(error: unknown): string {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } })?.meta?.driverAdapterError?.cause;
  return cause?.originalMessage ?? (error instanceof Error ? error.message : String(error));
}

export function uniqueKey(prefix = 'key'): string {
  return `${prefix}-${RUN}-${Math.random().toString(36).slice(2, 12)}`;
}

export function todayInBusinessZone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
