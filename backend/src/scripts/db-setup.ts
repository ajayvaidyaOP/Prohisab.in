/**
 * One-command database setup for local VS Code development and cloud deployments.
 *
 *   npm run db:setup          # creates DB (if permitted), tables, triggers, and admin account
 *   npm run db:setup:demo     # also adds sample [DEMO] customer & supplier accounts
 *
 * Works with local MySQL, XAMPP, MariaDB, Aiven, TiDB Cloud, and Railway MySQL
 * without requiring the Prisma Rust schema-engine binary download.
 */
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');
const envPath = path.join(backendRoot, '.env');
const envExamplePath = path.join(backendRoot, '.env.example');

if (!existsSync(envPath) && existsSync(envExamplePath) && !process.env.DATABASE_URL) {
  copyFileSync(envExamplePath, envPath);
  console.log('Created backend/.env from backend/.env.example.');
}

import { env } from '../config/env.ts';
import { buildPoolConfig, prisma } from '../db/prisma.ts';
import { hashPassword } from '../lib/password.ts';
import { writeAudit } from '../lib/audit.ts';
import { createAccountInTx } from '../modules/accounts/accounts.service.ts';
import { accountCreateBody } from '../modules/accounts/accounts.schemas.ts';
import { createTransactionBody } from '../modules/transactions/transactions.schemas.ts';
import { postTransaction } from '../modules/transactions/transactions.service.ts';
import { todayInTimeZone, addDays } from '../lib/dates.ts';
import { getSettings } from '../modules/settings/settings.service.ts';

const args = new Set(process.argv.slice(2));

async function ensureDatabaseAndTables(): Promise<void> {
  if (process.env.USE_EMBEDDED_DB === 'true') {
    console.log('\n[1/3] Using embedded local database (.erp-local-db.json)...');
    console.log('[2/3] Embedded ERP tables & ledger rules ready.');
    return;
  }
  const poolCfg = buildPoolConfig(env.DATABASE_URL);
  const dbName = poolCfg.database;

  console.log(`\n[1/3] Connecting to MySQL at ${poolCfg.host}:${poolCfg.port} as "${poolCfg.user}"...`);

  // Step 1: Try creating the database if it doesn't exist yet (works for local root/admin users).
  try {
    const serverConn = await mariadb.createConnection({
      host: poolCfg.host,
      port: poolCfg.port,
      user: poolCfg.user,
      password: poolCfg.password,
      ...(poolCfg.ssl ? { ssl: poolCfg.ssl } : {}),
      connectTimeout: 10_000,
    });
    try {
      const safeDbName = dbName.replace(/`/g, '``');
      await serverConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
      );
      console.log(`  ✔ Database "${dbName}" is ready.`);
    } finally {
      await serverConn.end();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // On managed cloud DBs (Aiven/TiDB/Railway) the database already exists and user may lack CREATE DATABASE privilege.
    if (/Access denied|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
      console.error('\n❌ Could not connect to MySQL!');
      console.error(`   Reason: ${msg}`);
      console.error('\n👉 How to fix this in VS Code:');
      console.error('   1. Make sure MySQL Server (or XAMPP MySQL) is running on port 3306.');
      console.error('   2. Open backend/.env and update DATABASE_URL with your actual MySQL password:');
      console.error('      DATABASE_URL="mysql://root:YOUR_MYSQL_PASSWORD@localhost:3306/erp_ledger"');
      console.error('      (If using XAMPP with no password: DATABASE_URL="mysql://root:@localhost:3306/erp_ledger")\n');
      process.exit(1);
    }
  }

  // Step 2: Connect to the target database and run migrations if needed.
  const conn = await mariadb.createConnection({
    host: poolCfg.host,
    port: poolCfg.port,
    user: poolCfg.user,
    password: poolCfg.password,
    database: dbName,
    ...(poolCfg.ssl ? { ssl: poolCfg.ssl } : {}),
    multipleStatements: true,
    connectTimeout: 10_000,
  });

  try {
    console.log('[2/3] Checking database tables & ledger safeguards...');
    const existingTables = (await conn.query(`SHOW TABLES LIKE 'AdminUser';`)) as unknown[];
    if (existingTables.length === 0) {
      const initSqlPath = path.join(backendRoot, 'prisma/migrations/20261015120000_init/migration.sql');
      const initSql = readFileSync(initSqlPath, 'utf8');
      await conn.query(initSql);
      console.log('  ✔ Created all ERP tables (AdminUser, Session, Account, LedgerEntry, AuditLog, IdempotencyKey, AppSetting).');
    } else {
      // Ensure `role` and `accountId` columns exist on AdminUser for databases created with an earlier schema.
      const roleCols = (await conn.query(`SHOW COLUMNS FROM \`AdminUser\` LIKE 'role';`)) as unknown[];
      if (roleCols.length === 0) {
        await conn.query(
          `ALTER TABLE \`AdminUser\`
             ADD COLUMN \`role\` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'ADMIN' AFTER \`passwordHash\`,
             ADD COLUMN \`accountId\` INTEGER NULL AFTER \`role\`,
             ADD UNIQUE INDEX \`AdminUser_accountId_key\`(\`accountId\`),
             ADD CONSTRAINT \`AdminUser_accountId_fkey\` FOREIGN KEY (\`accountId\`) REFERENCES \`Account\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE;`,
        );
        console.log('  ✔ Upgraded AdminUser table with role and accountId columns.');
      }
      const optionCols = (await conn.query(`SHOW COLUMNS FROM \`AppSetting\` LIKE 'userEntryOptions';`)) as unknown[];
      if (optionCols.length === 0) {
        await conn.query(`ALTER TABLE \`AppSetting\` ADD COLUMN \`userEntryOptions\` JSON NULL AFTER \`timezone\`;`);
        console.log('  ✔ Upgraded AppSetting table with userEntryOptions column.');
      }
      const approvalCols = (await conn.query(`SHOW COLUMNS FROM \`LedgerEntry\` LIKE 'approvalStatus';`)) as unknown[];
      if (approvalCols.length === 0) {
        await conn.query(
          `ALTER TABLE \`LedgerEntry\`
             ADD COLUMN \`approvalStatus\` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED' AFTER \`reversalOfId\`,
             ADD COLUMN \`reviewedById\` INTEGER NULL AFTER \`approvalStatus\`,
             ADD COLUMN \`reviewedAt\` DATETIME(3) NULL AFTER \`reviewedById\`,
             ADD COLUMN \`rejectionReason\` VARCHAR(300) NULL AFTER \`reviewedAt\`,
             ADD INDEX \`LedgerEntry_approvalStatus_createdAt_idx\`(\`approvalStatus\`, \`createdAt\`),
             ADD CONSTRAINT \`LedgerEntry_reviewedById_fkey\` FOREIGN KEY (\`reviewedById\`) REFERENCES \`AdminUser\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;`,
        );
        await conn.query(`DROP TRIGGER IF EXISTS \`LedgerEntry_prevent_update\`;`).catch(() => undefined);
        await conn
          .query(
            `CREATE TRIGGER \`LedgerEntry_prevent_update\`
             BEFORE UPDATE ON \`LedgerEntry\`
             FOR EACH ROW
             BEGIN
               IF NOT (
                 OLD.\`approvalStatus\` = 'PENDING'
                 AND NEW.\`approvalStatus\` IN ('APPROVED', 'REJECTED')
                 AND OLD.\`accountId\` = NEW.\`accountId\`
                 AND OLD.\`entryDate\` = NEW.\`entryDate\`
                 AND OLD.\`type\` = NEW.\`type\`
                 AND OLD.\`side\` = NEW.\`side\`
                 AND OLD.\`direction\` = NEW.\`direction\`
                 AND OLD.\`amount\` = NEW.\`amount\`
                 AND (OLD.\`reversalOfId\` <=> NEW.\`reversalOfId\`)
               ) THEN
                 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entries are immutable. Create a reversal entry instead.';
               END IF;
             END;`,
          )
          .catch(() => undefined);
        console.log('  ✔ Upgraded LedgerEntry table with approvalStatus and review columns.');
      } else {
        console.log('  ✔ ERP tables already exist.');
      }
    }

    const existingTriggers = (await conn.query(
      `SHOW TRIGGERS WHERE \`Trigger\` = 'LedgerEntry_validate_insert';`,
    )) as unknown[];
    if (existingTriggers.length === 0) {
      try {
        await conn.query('SET GLOBAL log_bin_trust_function_creators = 1;').catch(() => undefined);
        const safeguardsSqlPath = path.join(
          backendRoot,
          'prisma/migrations/20261015120100_ledger_db_safeguards/migration.sql',
        );
        const safeguardsSql = readFileSync(safeguardsSqlPath, 'utf8');
        await conn.query(safeguardsSql);
        console.log('  ✔ Installed database-level ledger safeguard triggers.');
      } catch (triggerErr: unknown) {
        const msg = triggerErr instanceof Error ? triggerErr.message : String(triggerErr);
        if (/already exists|Duplicate/i.test(msg)) {
          console.log('  ✔ Database-level ledger safeguard triggers already exist.');
        } else {
          console.warn(
            `  ⚠ Note: Could not create MySQL triggers (${msg.slice(0, 120)}). Application-level ledger safeguards remain active.`,
          );
        }
      }
    } else {
      console.log('  ✔ Database-level ledger safeguard triggers already exist.');
    }
  } finally {
    await conn.end();
  }
}

async function ensureAdminAndOptionalDemo(): Promise<void> {
  console.log('[3/3] Checking administrator account...');
  const existing = await prisma.adminUser.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  const username = (env.ADMIN_USERNAME?.trim() || 'admin');
  const password = (env.ADMIN_PASSWORD || 'Admin@12345');

  if (existing && !args.has('--reset-password')) {
    console.log(`  ✔ Administrator "${existing.username}" already exists.`);
  } else {
    const passwordHash = await hashPassword(password);
    if (existing) {
      await prisma.adminUser.update({ where: { id: existing.id }, data: { passwordHash } });
      await prisma.session.deleteMany({ where: { adminUserId: existing.id } });
      console.log(`  ✔ Updated password for administrator "${existing.username}".`);
    } else {
      const admin = await prisma.adminUser.create({ data: { username, passwordHash, role: 'ADMIN' } });
      await writeAudit(prisma, {
        action: 'ADMIN_CREATED',
        entityType: 'AdminUser',
        entityId: admin.id,
        actorId: admin.id,
      });
      console.log(`  ✔ Created administrator account:`);
      console.log(`      Username: ${username}`);
      console.log(`      Password: ${password}`);
    }
  }

  if (args.has('--demo')) {
    const admin = await prisma.adminUser.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
    if (admin && (await prisma.account.count()) === 0) {
      const settings = await getSettings();
      const today = todayInTimeZone(settings.timezone);
      const demoUser1 = accountCreateBody.parse({
        name: 'Rahul Sharma',
        type: 'CUSTOMER',
        username: 'rahul',
        password: 'rahul123',
        phone: '+91 98200 00001',
        openingBalance: '0.00',
        openingBalanceSide: 'RECEIVABLE',
        notes: 'Demo User (Login with username: rahul / password: rahul123)',
      });
      const demoUser2 = accountCreateBody.parse({
        name: 'Amit Verma',
        type: 'CUSTOMER',
        username: 'amit',
        password: 'amit123',
        phone: '+91 98200 00003',
        openingBalance: '0.00',
        openingBalanceSide: 'RECEIVABLE',
        notes: 'Demo User (Login with username: amit / password: amit123)',
      });

      await prisma.$transaction(async (tx) => {
        const user1 = await createAccountInTx(tx, demoUser1, admin.id);
        await postTransaction(
          tx,
          createTransactionBody.parse({
            accountId: user1.id,
            type: 'CREDIT_SALE',
            entryDate: addDays(today, -4),
            amount: '1500.00',
            paymentMethod: 'UPI',
            referenceNumber: 'CRD-101',
            notes: 'Material credit entry #1',
          }),
          admin.id,
          today,
          'ADMIN',
        );
        await postTransaction(
          tx,
          createTransactionBody.parse({
            accountId: user1.id,
            type: 'CREDIT_SALE',
            entryDate: addDays(today, -2),
            amount: '800.00',
            paymentMethod: 'CASH',
            referenceNumber: 'CRD-102',
            notes: 'Transport & hardware credit',
          }),
          admin.id,
          today,
          'ADMIN',
        );
        await postTransaction(
          tx,
          createTransactionBody.parse({
            accountId: user1.id,
            type: 'PAYMENT_RECEIVED',
            entryDate: today,
            amount: '1000.00',
            paymentMethod: 'UPI',
            referenceNumber: 'SETTLE-01',
            notes: 'Settlement received via UPI',
          }),
          admin.id,
          today,
          'ADMIN',
        );
        // Also add one PENDING entry submitted by user1 so Admin can test Approve/Reject right away
        await postTransaction(
          tx,
          createTransactionBody.parse({
            accountId: user1.id,
            type: 'CREDIT_SALE',
            entryDate: today,
            amount: '450.00',
            paymentMethod: 'UPI',
            referenceNumber: 'SUB-103',
            notes: 'Submitted by Rahul (awaiting Admin approval)',
          }),
          admin.id,
          today,
          'USER',
        );

        const user2 = await createAccountInTx(tx, demoUser2, admin.id);
        await postTransaction(
          tx,
          createTransactionBody.parse({
            accountId: user2.id,
            type: 'CREDIT_SALE',
            entryDate: addDays(today, -1),
            amount: '1200.00',
            paymentMethod: 'UPI',
            referenceNumber: 'CRD-201',
            notes: 'Monthly credit entry for Amit',
          }),
          admin.id,
          today,
          'ADMIN',
        );
      });
      console.log('  ✔ Added demo users with login credentials:');
      console.log('      User 1 -> Username: rahul  | Password: rahul123');
      console.log('      User 2 -> Username: amit   | Password: amit123');
    }
  }

  console.log('\n✅ Database setup complete! You can now start the app with: npm run dev\n');
}

async function main(): Promise<void> {
  await ensureDatabaseAndTables();
  await ensureAdminAndOptionalDemo();
}

main()
  .catch((error: unknown) => {
    console.error(`\n❌ Database setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
