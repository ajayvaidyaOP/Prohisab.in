import { randomBytes } from 'node:crypto';
import mariadb, { type Connection } from 'mariadb';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.ts';
import { buildPoolConfig } from '../config/database.ts';
import { migrate, migrationSql, statements, DIRECT_ENTRIES } from './migrate.ts';

/**
 * One-time import from the 2025 Express/Prisma schema into the Spring-compatible
 * ledger. The legacy tables are NEVER dropped or altered; the new rows are copied
 * atomically. Do not run against a database already migrated by Spring V2.
 * Require an operator-confirmed MySQL backup; DDL outside the copy transaction
 * cannot be rolled back even when import fails.
 */
const time = (raw: unknown) => raw instanceof Date ? raw : new Date(String(raw));
const date = (raw: unknown) => raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
const str = (value: unknown) => value == null ? null : String(value);
const id = (value: unknown) => Number(value);
const required = (value: unknown, field: string, limit: number) => {
  const text = String(value ?? '');
  if (!text.trim() || text.length > limit) throw new Error(`${field} must be nonempty and at most ${limit} characters. Legacy rows were not changed.`);
  return text;
};
const limited = (value: unknown, field: string, limit: number) => {
  const text = str(value);
  if (text && text.length > limit) throw new Error(`${field} exceeds ${limit} characters. Resolve this field manually before importing; legacy rows were not changed.`);
  return text;
};

type LegacyRow = Record<string, unknown>;
export async function importLegacy(conn: Connection) {
  const existing = await conn.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND LOWER(table_name) IN ('adminuser','account','ledgerentry','appsetting','auditlog')`);
  const names = new Set(existing.map((row: LegacyRow) => String(row.TABLE_NAME ?? row.table_name).toLowerCase()));
  for (const table of ['AdminUser', 'Account', 'LedgerEntry', 'AppSetting', 'AuditLog']) {
    if (!names.has(table.toLowerCase())) throw new Error(`Legacy table ${table} is missing. Nothing was changed. Verify DATABASE_URL and the backup.`);
  }
  await migrate(conn, { allowLegacy: true }); // Only adds new tables; never edits the legacy ones.
  const [{ count: users }] = await conn.query('SELECT COUNT(*) AS count FROM users');
  const [{ count: entries }] = await conn.query('SELECT COUNT(*) AS count FROM transactions');
  if (Number(users) || Number(entries)) {
    throw new Error('New ledger already has users or transactions; refusing to duplicate or overwrite them. Legacy tables were not changed.');
  }
  // A single MariaDB connection executes these in order; do not pipeline
  // Promise.all queries on it during a one-time financial data import.
  const logins: LegacyRow[] = await conn.query('SELECT * FROM `AdminUser` ORDER BY id');
  const accounts: LegacyRow[] = await conn.query('SELECT * FROM `Account` ORDER BY id');
  const ledger: LegacyRow[] = await conn.query('SELECT * FROM `LedgerEntry` ORDER BY id');
  const audits: LegacyRow[] = await conn.query('SELECT * FROM `AuditLog` ORDER BY id');
  const settings: LegacyRow[] = await conn.query('SELECT * FROM `AppSetting` ORDER BY id');
  const loginsByAccount = new Map(logins.filter((row) => row.accountId != null).map((row) => [id(row.accountId), row]));
  const loginIds = new Map<number, number>();
  const userIds = new Map<number, number>();
  const ledgerIds = new Map<number, number>();
  const usedNames = new Set<string>();
  const uniqueName = (raw: unknown, code: string) => {
    let candidate = required(raw, `name (${code})`, 150).trim();
    let normalized = candidate.toLocaleLowerCase('en');
    if (usedNames.has(normalized)) {
      // Java requires unique login names, while the old schema allowed duplicate
      // customer names. Keep the original text in the retained legacy table.
      candidate = `${candidate.slice(0, 150 - code.length - 3)} [${code}]`;
      normalized = candidate.toLocaleLowerCase('en');
    }
    if (usedNames.has(normalized)) throw new Error(`Name collision during import for ${code}.`);
    usedNames.add(normalized);
    return { candidate, normalized };
  };
  const insertUser = async (rawName: unknown, accountCode: string, passwordHash: string, role: string,
    account: LegacyRow | null, createdAt: unknown, updatedAt: unknown) => {
    const { candidate, normalized } = uniqueName(rawName, accountCode);
    const result = await conn.query(`INSERT INTO users
      (name, name_normalized, password_hash, role, account_code, phone, email, address, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [candidate, normalized,
      required(passwordHash, `password hash (${accountCode})`, 255), role, required(accountCode, 'account code', 20),
      limited(account?.phone, 'phone', 30), limited(account?.email, 'email', 190),
      limited(account?.address, 'address', 500), limited(account?.notes, 'notes', 500),
      account?.isActive === false || account?.isActive === 0 ? false : true, time(createdAt), time(updatedAt)]);
    return id(result.insertId);
  };
  await conn.beginTransaction();
  try {
    for (const login of logins.filter((row) => row.accountId == null)) {
      const userId = await insertUser(login.username, `ADM-${String(login.id).padStart(6, '0')}`,
        String(login.passwordHash), login.role === 'USER' ? 'USER' : 'ADMIN', null, login.createdAt, login.updatedAt);
      loginIds.set(id(login.id), userId);
    }
    for (const account of accounts) {
      const oldId = id(account.id);
      const login = loginsByAccount.get(oldId);
      // Accounts without a login get an unusable random password; the admin can
      // set one later. Never create a shared default password for imported users.
      const passwordHash = login?.passwordHash ? String(login.passwordHash)
        : await bcrypt.hash(randomBytes(32).toString('hex'), 12);
      const userId = await insertUser(account.name, String(account.accountCode), passwordHash,
        login?.role === 'ADMIN' ? 'ADMIN' : 'USER', account, account.createdAt, account.updatedAt);
      userIds.set(oldId, userId);
      if (login) loginIds.set(id(login.id), userId);
    }
    for (const login of logins) {
      if (!loginIds.has(id(login.id))) throw new Error(`Legacy login ${login.id} has an unknown accountId ${login.accountId}.`);
    }
    const adminId = loginIds.get(id(logins.find((row) => row.role === 'ADMIN')?.id));
    for (const account of accounts) {
      if (account.openingBalance == null || Number(account.openingBalance) === 0) continue;
      const amount = String(account.openingBalance);
      if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
        throw new Error(`Invalid legacy opening balance for Account ${account.id}.`);
      }
      const accountId = userIds.get(id(account.id));
      // Old account opening balances had no entry row. Represent them as a dated
      // approved opening entry, retaining their original side in the detail.
      await conn.query(`INSERT INTO transactions
        (user_id, entry_date, kind, amount, option_name, detail, approval_status, reviewed_by_id,
         reviewed_at, created_by_id, created_at, updated_at)
        VALUES (?, ?, 'DEPOSIT', ?, 'Opening Balance', ?, 'APPROVED', ?, ?, ?, ?, ?)`,
      [accountId, date(account.createdAt), amount,
        `Imported ${account.openingBalanceSide ?? account.type ?? 'RECEIVABLE'} opening balance`,
        adminId ?? null, adminId ? time(account.createdAt) : null, adminId ?? null,
        time(account.createdAt), time(account.createdAt)]);
    }
    for (const row of ledger) {
      const owner = userIds.get(id(row.accountId));
      if (!owner) throw new Error(`LedgerEntry ${row.id} references unknown Account ${row.accountId}.`);
      const createdBy = row.createdById == null ? null : loginIds.get(id(row.createdById));
      const reviewedBy = row.reviewedById == null ? null : loginIds.get(id(row.reviewedById));
      if (row.createdById != null && !createdBy) throw new Error(`LedgerEntry ${row.id} references unknown creator.`);
      if (row.reviewedById != null && !reviewedBy) throw new Error(`LedgerEntry ${row.id} references unknown reviewer.`);
      const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(String(row.approvalStatus))
        ? String(row.approvalStatus) : 'APPROVED';
      const result = await conn.query(`INSERT INTO transactions
        (user_id, entry_date, kind, amount, option_name, detail, reference_number, payment_method,
         approval_status, reviewed_by_id, reviewed_at, rejection_reason, created_by_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        owner, date(row.entryDate), row.direction === 'DECREASE' ? 'WITHDRAWAL' : 'DEPOSIT',
        String(row.amount), required(row.type, `LedgerEntry ${row.id} type`, 120),
        limited(row.notes, 'ledger note', 500), limited(row.referenceNumber, 'reference number', 100),
        limited(row.paymentMethod, 'payment method', 20), status,
        reviewedBy ?? null, row.reviewedAt == null ? null : time(row.reviewedAt),
        limited(row.rejectionReason, 'rejection reason', 300), createdBy ?? null,
        time(row.createdAt), time(row.createdAt),
      ]);
      ledgerIds.set(id(row.id), id(result.insertId));
    }
    for (const row of ledger) {
      if (row.reversalOfId == null) continue;
      const reversalId = ledgerIds.get(id(row.id));
      const originalId = ledgerIds.get(id(row.reversalOfId));
      if (!reversalId || !originalId) throw new Error(`Ledger reversal ${row.id} references a missing entry.`);
      await conn.query('UPDATE transactions SET reversal_of_id = ? WHERE id = ?', [originalId, reversalId]);
      await conn.query('UPDATE transactions SET reversed_by_id = ? WHERE id = ?', [reversalId, originalId]);
    }
    for (const row of audits) {
      const actor = row.actorId == null ? null : loginIds.get(id(row.actorId));
      if (row.actorId != null && !actor) throw new Error(`AuditLog ${row.id} references an unknown actor.`);
      const details = row.details == null ? null
        : typeof row.details === 'string' ? row.details : JSON.stringify(row.details);
      const oldReference = String(row.entityId);
      const referenceId = /^\d+$/.test(oldReference) ? Number(oldReference) : null;
      const mappedReference = referenceId === null ? null
        : row.entityType === 'Account' ? userIds.get(referenceId)
          : row.entityType === 'AdminUser' ? loginIds.get(referenceId)
            : row.entityType === 'LedgerEntry' ? ledgerIds.get(referenceId) : null;
      await conn.query(`INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [required(row.action, 'audit action', 80),
        required(row.entityType, 'audit entity type', 60),
        required(mappedReference ?? row.entityId, 'audit entity id', 60),
        actor ?? null, limited(details, 'audit details', 2000), time(row.createdAt)]);
    }
    // Import preserves rejected history, but no pending entries remain in the direct-posting app.
    for (const sql of statements(migrationSql(DIRECT_ENTRIES)).filter((sql) => !sql.startsWith('ALTER TABLE'))) {
      await conn.query(sql);
    }
    if (settings.length) {
      const source = settings[0];
      await conn.query(`INSERT INTO app_settings
        (id, business_name, business_address, business_phone, business_email, currency_symbol, timezone, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)`, [
        required(source.businessName ?? 'My Business', 'business name', 150),
        limited(source.businessAddress, 'business address', 500), limited(source.businessPhone, 'business phone', 30),
        limited(source.businessEmail, 'business email', 190),
        required(source.currencySymbol ?? '₹', 'currency symbol', 8),
        required(source.timezone ?? 'Asia/Kolkata', 'timezone', 64), time(source.updatedAt),
      ]);
      let options: unknown = source.userEntryOptions;
      if (typeof options === 'string') options = JSON.parse(options);
      if (Array.isArray(options)) {
        for (const [sortOrder, item] of options.entries()) {
          if (typeof item !== 'string' || !item.trim()) continue;
          const name = required(item.trim(), 'entry option', 120);
          await conn.query(`INSERT IGNORE INTO entry_options (name, name_normalized, sort_order)
            VALUES (?, ?, ?)`, [name, name.toLocaleLowerCase('en'), sortOrder]);
        }
      }
    }
    await conn.query(`INSERT INTO node_schema_migrations (name, checksum) VALUES ('legacy-express-import', ?)` ,
      ['legacy-express-import-2026'.padEnd(64, '0')]);
    await conn.commit();
    console.log(`Imported ${logins.length} logins, ${accounts.length} accounts, ${ledger.length} entries, and ${audits.length} audit events. Legacy tables were left intact.`);
    console.log('Sessions and old idempotency tokens were deliberately not imported; users must log in again.');
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}

async function main() {
  if (!process.argv.includes('--i-have-a-backup')) {
    throw new Error('Export/backup MySQL first, then explicitly pass --i-have-a-backup. No data was changed.');
  }
  const conn = await mariadb.createConnection(buildPoolConfig(env.DATABASE_URL));
  try { await importLegacy(conn); } finally { await conn.end(); }
}
if (process.argv[1] && /(?:^|\/)import-legacy\.(?:ts|js)$/.test(process.argv[1])) {
  main().catch((error) => { console.error(`Legacy import failed: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
}
