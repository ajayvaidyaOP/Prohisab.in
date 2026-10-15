import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.ts';
import { env } from '../config/env.ts';

/**
 * Builds the MySQL connection settings from DATABASE_URL.
 * Format: mysql://USER:PASSWORD@HOST:PORT/DATABASE
 * Credentials stay on the server; they are never sent to the browser.
 */
function buildPoolConfig(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL must include a database name, e.g. mysql://user:pass@localhost:3306/erp_ledger');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    // Store and read DATE/DATETIME values in UTC regardless of the server or machine time zone.
    timezone: 'Z',
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    ...(env.DB_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  } as const;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaMariaDb(buildPoolConfig(env.DATABASE_URL));
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = createPrismaClient();
export type DbClient = typeof prisma;
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
