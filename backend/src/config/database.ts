import { env } from './env.ts';

/** Parse the server-only MySQL URL (never exposed to the browser). */
export function buildPoolConfig(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('DATABASE_URL must contain a simple MySQL database name, e.g. mysql://user:pass@localhost:3306/depositin');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    timezone: 'Z',
    ...(env.DB_SSL ? { ssl: { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : {}),
  } as const;
}
