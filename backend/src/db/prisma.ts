import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient, type Prisma } from '@prisma/client';
import { env } from '../config/env.ts';
import { buildPoolConfig } from '../config/database.ts';

// The demo uses the same MySQL dialect/schema via an in-process MariaDB WASM
// adapter; production always connects to the real MySQL server.
const demo = process.env.USE_EMBEDDED_DB === 'true' ? await import('./demo.ts').then((m) => m.createDemo()) : null;
export const prisma = new PrismaClient({
  adapter: demo ? demo.adapter : new PrismaMariaDb(buildPoolConfig(env.DATABASE_URL)),
  // Expected uniqueness conflicts (idempotent replays) are handled at the API
  // boundary; do not let Prisma print a scary stack trace for every replay.
  log: env.NODE_ENV === 'development' ? ['warn'] : [],
});
export const demoDatabase = demo?.database ?? null;
export type Tx = Prisma.TransactionClient;
export type Db = Tx | typeof prisma;
