import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mariadb, { type Connection } from 'mariadb';
import { env } from '../config/env.ts';
import { buildPoolConfig } from '../config/database.ts';

export const BASELINE = '20261017000000_spring_schema';
export const NODE_SUPPORT = '20261017010000_node_support';
export const migrationSql = (name: string) => readFileSync(path.resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');

/** Migrations here are simple DDL; no SQL strings contain semicolons. */
export function statements(sql: string) {
  return sql.replace(/^\s*--.*$/gm, '').split(';').map((line) => line.trim()).filter(Boolean);
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function exists(conn: Connection, kind: 'tables' | 'columns' | 'statistics', name: string, table?: string) {
  const sql = kind === 'tables'
    ? 'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER(?) LIMIT 1'
    : kind === 'columns'
      ? 'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1'
      : 'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1';
  const rows = await conn.query(sql, kind === 'tables' ? [name] : [table, name]);
  return rows.length > 0;
}

async function recorded(conn: Connection, name: string, sql: string) {
  const rows = await conn.query('SELECT checksum FROM node_schema_migrations WHERE name = ?', [name]);
  if (rows.length && rows[0].checksum !== sha256(sql)) {
    throw new Error(`Migration ${name} changed after being applied. Inspect the database before continuing.`);
  }
  return rows.length > 0;
}
async function mark(conn: Connection, name: string, sql: string) {
  await conn.query('INSERT IGNORE INTO node_schema_migrations (name, checksum) VALUES (?, ?)', [name, sha256(sql)]);
}

export async function migrate(conn: Connection, { allowLegacy = false } = {}) {
  const baseline = migrationSql(BASELINE);
  const support = migrationSql(NODE_SUPPORT);
  const hasUsers = await exists(conn, 'tables', 'users');
  if (!hasUsers) {
    if (!allowLegacy && (await exists(conn, 'tables', 'Account') || await exists(conn, 'tables', 'AdminUser'))) {
      throw new Error('Legacy Express tables detected, but the new ledger schema is missing. Back up MySQL, then run `npm run db:import-legacy -- --i-have-a-backup`. Nothing was changed.');
    }
    console.log('Creating the ledger schema (new database)...');
    for (const sql of statements(baseline)) await conn.query(sql);
  } else {
    // Existing Flyway database: its schema and rows are authoritative. Never re-run
    // CREATE TABLE/ALTER from the baseline against a populated ledger. Check the
    // full mapped shape before adding anything; partially upgraded DBs fail closed.
    const required: Record<string, string[]> = {
      users: ['id', 'name', 'name_normalized', 'password_hash', 'role', 'account_code',
        'phone', 'email', 'address', 'notes', 'is_active', 'pin', 'back_date_entry',
        'back_date_allowed_date', 'created_at', 'updated_at'],
      sessions: ['id', 'user_id', 'created_at', 'last_seen_at', 'expires_at', 'user_agent'],
      transactions: ['id', 'user_id', 'entry_date', 'kind', 'amount', 'option_name',
        'detail', 'reference_number', 'payment_method', 'reversal_of_id', 'reversed_by_id',
        'approval_status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
        'created_by_id', 'created_at', 'updated_at', 'book_id', 'customer_id', 'bank_details'],
      entry_options: ['id', 'name', 'name_normalized', 'sort_order', 'is_active', 'created_at', 'updated_at'],
      app_settings: ['id', 'business_name', 'business_address', 'business_phone',
        'business_email', 'currency_symbol', 'timezone', 'logo_url', 'updated_at'],
      books: ['id', 'name', 'status', 'created_at', 'updated_at'],
      user_books: ['user_id', 'book_id'],
      audit_logs: ['id', 'action', 'entity_type', 'entity_id', 'actor_id', 'details', 'created_at'],
    };
    const rows = await conn.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = DATABASE()`);
    const columns = new Set(rows.map((row: { TABLE_NAME?: string; table_name?: string;
      COLUMN_NAME?: string; column_name?: string }) => `${row.table_name ?? row.TABLE_NAME}.${row.column_name ?? row.COLUMN_NAME}`));
    for (const [table, names] of Object.entries(required)) {
      for (const column of names) {
        if (!columns.has(`${table}.${column}`)) throw new Error(`Existing database is missing ${table}.${column}. Complete the Spring/Flyway upgrade before switching backends. No existing data was changed.`);
      }
    }
    console.log('Existing Spring ledger detected; all users, books and entries remain in place.');
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS node_schema_migrations (
    name VARCHAR(100) NOT NULL PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  if (!await recorded(conn, BASELINE, baseline)) await mark(conn, BASELINE, baseline);
  if (!await recorded(conn, NODE_SUPPORT, support)) {
    if (!await exists(conn, 'columns', 'pin_digest', 'users')) await conn.query('ALTER TABLE users ADD COLUMN pin_digest VARCHAR(64) NULL');
    if (!await exists(conn, 'columns', 'pin_hash', 'users')) await conn.query('ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) NULL');
    if (!await exists(conn, 'statistics', 'users_pin_digest_uq', 'users')) {
      await conn.query('CREATE UNIQUE INDEX users_pin_digest_uq ON users (pin_digest)');
    }
    if (!await exists(conn, 'tables', 'idempotency_keys')) {
      const create = statements(support).find((statement) => statement.startsWith('CREATE TABLE'));
      if (!create) throw new Error('Missing idempotency_keys migration.');
      await conn.query(create);
    }
    await mark(conn, NODE_SUPPORT, support);
    console.log('Applied additive Node support (PIN hashes + idempotency table).');
  }
}

export async function migrateMySql() {
  const config = buildPoolConfig(env.DATABASE_URL);
  let conn: Connection;
  try {
    conn = await mariadb.createConnection(config);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ER_BAD_DB_ERROR') throw error;
    conn = await mariadb.createConnection({ ...config, database: undefined });
    await conn.query(`CREATE DATABASE \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${config.database}\``);
  }
  try { await migrate(conn); } finally { await conn.end(); }
}

if (process.argv[1] && /(?:^|\/)migrate\.(?:ts|js)$/.test(process.argv[1])) {
  migrateMySql().catch((error) => { console.error(`Migration failed: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
}
