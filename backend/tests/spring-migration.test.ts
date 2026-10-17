import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lite4MariaDB, type SqlParam } from 'lite4mariadb';
import type { Connection } from 'mariadb';
import { BASELINE, migrate, migrationSql } from '../src/scripts/migrate.ts';

test('deploys additive changes against a populated Spring ledger without touching existing rows', async () => {
  const db = await Lite4MariaDB.create();
  try {
    db.execMulti(migrationSql(BASELINE)); // The same table definitions as the final Spring/Flyway schema.
    db.exec(`INSERT INTO users (name,name_normalized,password_hash,role,account_code,pin)
      VALUES ('Spring Staff','spring staff','spring-bcrypt-hash','USER','USR-000001','1234')`);
    db.exec(`INSERT INTO books (name) VALUES ('Existing Book')`);
    db.exec(`INSERT INTO user_books (user_id,book_id) VALUES (1,1)`);
    db.exec(`INSERT INTO transactions (user_id,entry_date,kind,amount,option_name,approval_status,book_id)
      VALUES (1,'2025-10-16','DEPOSIT',42.75,'Cash Deposit','APPROVED',1)`);
    const conn = {
      async query(sql: string, params: unknown[] = []) {
        const args = params.map((value) => value instanceof Date
          ? value.toISOString().slice(0, 23).replace('T', ' ') : value as SqlParam);
        return db.exec(sql, args as SqlParam[]).rows;
      },
    } as unknown as Connection;
    await migrate(conn);
    await migrate(conn); // Safe to rerun; checksums stop accidental edits.
    assert.equal(db.query('SELECT COUNT(*) AS total FROM users')[0].total, 1);
    assert.equal(db.query('SELECT pin FROM users')[0].pin, '1234'); // Lazy upgrade on PIN login, not during DDL.
    assert.equal(db.query('SELECT amount FROM transactions')[0].amount, '42.75');
    assert.equal(db.query('SELECT name FROM books')[0].name, 'Existing Book');
    assert.equal(db.query('SELECT COUNT(*) AS total FROM user_books')[0].total, 1);
    assert.equal(db.query('SELECT COUNT(*) AS total FROM node_schema_migrations')[0].total, 3);
    assert.equal(db.query('SELECT COUNT(*) AS total FROM idempotency_keys')[0].total, 0);
    assert.equal(db.query("SHOW COLUMNS FROM users LIKE 'pin_hash'").length, 1);
    db.exec('ALTER TABLE transactions DROP COLUMN bank_details');
    await assert.rejects(migrate(conn), /missing transactions.bank_details/);
    assert.equal(db.query('SELECT COUNT(*) AS total FROM users')[0].total, 1);
  } finally { await db.close(); }
});

test('direct-entry upgrade posts pending rows once, retains rejected history and backfills edits', async () => {
  const db = await Lite4MariaDB.create();
  try {
    db.execMulti(migrationSql(BASELINE));
    db.exec(`INSERT INTO users (name,name_normalized,password_hash,role,account_code)
      VALUES ('Staff','staff','hash','USER','USR-000001')`);
    db.exec(`INSERT INTO transactions (user_id,entry_date,kind,amount,option_name,approval_status)
      VALUES (1,'2026-10-18','WITHDRAWAL',10.50,'Cash Withdrawal','PENDING'),
      (1,'2026-10-18','DEPOSIT',15.00,'Cash Deposit','REJECTED')`);
    db.exec(`INSERT INTO audit_logs (action,entity_type,entity_id,created_at)
      VALUES ('TRANSACTION_EDITED','LedgerTransaction','1','2026-10-18 01:01:01')`);
    const conn = { async query(sql: string, params: SqlParam[] = []) { return db.exec(sql, params).rows; } } as unknown as Connection;
    await migrate(conn);
    await migrate(conn);
    const rows = db.query('SELECT approval_status,amount,edited_at FROM transactions ORDER BY id');
    assert.equal(rows[0].approval_status, 'APPROVED');
    assert.equal(rows[0].amount, '10.50');
    assert.ok(rows[0].edited_at);
    assert.equal(rows[1].approval_status, 'REJECTED');
    assert.equal(rows[1].edited_at, null);
    assert.equal(db.query("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'TRANSACTION_AUTO_POSTED'")[0].total, 1);
    db.exec(`INSERT INTO transactions (user_id,entry_date,kind,amount,option_name)
      VALUES (1,'2026-10-18','DEPOSIT',1,'Cash Deposit')`);
    assert.equal(db.query('SELECT approval_status FROM transactions WHERE id = 3')[0].approval_status, 'APPROVED');
  } finally { await db.close(); }
});
