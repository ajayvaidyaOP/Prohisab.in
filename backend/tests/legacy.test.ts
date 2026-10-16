import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { Lite4MariaDB, type SqlParam } from 'lite4mariadb';
import type { Connection } from 'mariadb';
import { importLegacy } from '../src/scripts/import-legacy.ts';

const databases: Lite4MariaDB[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });

function makeConnection(db: Lite4MariaDB) {
  return {
    async query(sql: string, params: unknown[] = []) {
      const args = params.map((value) => value instanceof Date
        ? value.toISOString().slice(0, 23).replace('T', ' ') : value as SqlParam);
      const result = db.exec(sql, args as SqlParam[]);
      if (/^\s*(INSERT|REPLACE)\b/i.test(sql)) {
        return { insertId: db.query<{ id: number }>('SELECT LAST_INSERT_ID() AS id')[0]?.id, affectedRows: result.affected };
      }
      return result.rows;
    },
    async beginTransaction() { db.exec('START TRANSACTION'); },
    async commit() { db.exec('COMMIT'); },
    async rollback() { db.exec('ROLLBACK'); },
  } as unknown as Connection;
}

async function legacyFixture() {
  const db = await Lite4MariaDB.create();
  databases.push(db);
  db.execMulti(readFileSync('tests/fixtures/legacy-express.sql', 'utf8'));
  const conn = makeConnection(db);
  const hash = await bcrypt.hash('OldPass123', 8);
  db.exec(`INSERT INTO Account (accountCode, name, type, openingBalance, openingBalanceSide, createdAt, updatedAt)
    VALUES ('CUS-1','Duplicate','CUSTOMER',5.00,'RECEIVABLE','2025-01-01','2025-01-01'),
      ('SUP-2','Duplicate','SUPPLIER',7.00,'PAYABLE','2025-02-01','2025-02-01')`);
  await conn.query(`INSERT INTO AdminUser (username,passwordHash,role,accountId,createdAt,updatedAt)
    VALUES ('admin',?,'ADMIN',NULL,'2025-01-01','2025-01-01'),
      ('old-staff',?,'USER',1,'2025-01-01','2025-01-01')`, [hash, hash]);
  db.exec(`INSERT INTO LedgerEntry (accountId,entryDate,type,side,direction,amount,approvalStatus,createdById,createdAt)
    VALUES (1,'2025-01-05','CREDIT_SALE','RECEIVABLE','INCREASE',2.50,'APPROVED',1,'2025-01-05'),
      (1,'2025-01-06','REVERSAL','RECEIVABLE','DECREASE',2.50,'APPROVED',1,'2025-01-06'),
      (1,'2025-01-07','PAYMENT_RECEIVED','RECEIVABLE','DECREASE',1.00,'PENDING',2,'2025-01-07')`);
  db.exec('UPDATE LedgerEntry SET reversalOfId = 1 WHERE id = 2');
  db.exec(`INSERT INTO AuditLog (action,entityType,entityId,actorId,details,createdAt)
    VALUES ('ACCOUNT_CREATED','Account','1',1,'{"legacy":true}','2025-01-01')`);
  db.exec(`INSERT INTO AppSetting (id,businessName,currencySymbol,timezone,userEntryOptions,updatedAt)
    VALUES (1,'Legacy Shop','₹','Asia/Kolkata','["Site Payment","Cash Deposit"]','2025-01-01')`);
  return { db, conn };
}

test('imports pre-Spring Express rows, opening balances, reversals, settings and audit history exactly once', async () => {
  const { db, conn } = await legacyFixture();
  await importLegacy(conn);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM `AdminUser`')[0].total, 2);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM `Account`')[0].total, 2);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM `LedgerEntry`')[0].total, 3);
  const users = db.query<{ name: string; account_code: string; password_hash: string }>(
    'SELECT name,account_code,password_hash FROM users ORDER BY id');
  assert.equal(users.length, 3);
  assert.deepEqual(users.map((row) => row.account_code), ['ADM-000001', 'CUS-1', 'SUP-2']);
  assert.ok(users[1].password_hash.startsWith('$2'));
  assert.equal(users[2].name, 'Duplicate [SUP-2]');
  const entries = db.query<{ option_name: string; approval_status: string; reversal_of_id: number | null; reversed_by_id: number | null }>(
    'SELECT option_name,approval_status,reversal_of_id,reversed_by_id FROM transactions ORDER BY id');
  assert.equal(entries.length, 5); // 2 opening balances + 3 old entries
  assert.deepEqual(entries.map((row) => row.option_name), [
    'Opening Balance', 'Opening Balance', 'CREDIT_SALE', 'REVERSAL', 'PAYMENT_RECEIVED',
  ]);
  assert.equal(entries[3].reversal_of_id, 3);
  assert.equal(entries[2].reversed_by_id, 4);
  assert.equal(entries[4].approval_status, 'PENDING');
  assert.equal(db.query('SELECT COUNT(*) AS total FROM audit_logs')[0].total, 1);
  assert.equal(db.query('SELECT entity_id FROM audit_logs')[0].entity_id, '2'); // Account 1 → new User 2.
  assert.equal(db.query('SELECT business_name FROM app_settings')[0].business_name, 'Legacy Shop');
  assert.equal(db.query('SELECT COUNT(*) AS total FROM entry_options')[0].total, 2);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM sessions')[0].total, 0);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM node_schema_migrations')[0].total, 3);
  await assert.rejects(importLegacy(conn), /already has users or transactions/);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM transactions')[0].total, 5);
});

test('rejects oversized legacy values atomically; operator can repair then retry without duplicates', async () => {
  const { db, conn } = await legacyFixture();
  db.exec('UPDATE Account SET address = ? WHERE id = 2', ['x'.repeat(501)]);
  await assert.rejects(importLegacy(conn), /address exceeds 500 characters/);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM users')[0].total, 0);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM transactions')[0].total, 0);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM `Account`')[0].total, 2);
  db.exec('UPDATE Account SET address = ? WHERE id = 2', ['repaired']);
  await importLegacy(conn);
  assert.equal(db.query('SELECT COUNT(*) AS total FROM users')[0].total, 3);
});
