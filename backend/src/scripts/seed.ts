/**
 * Creates the single administrator (the business owner). There is no public registration.
 *
 *   npm run seed                 # prompts for username and password (password input is hidden)
 *   npm run seed -- --reset-password   # set a new password for the existing admin (recovery)
 *   npm run seed -- --demo       # also adds clearly-labelled demo customers and suppliers
 *
 * Non-interactive: set ADMIN_USERNAME and ADMIN_PASSWORD in backend/.env (never commit that file).
 */
import { createInterface } from 'node:readline';
import { prisma } from '../db/prisma.ts';
import { env } from '../config/env.ts';
import { hashPassword } from '../lib/password.ts';
import { writeAudit } from '../lib/audit.ts';
import { createAccountInTx } from '../modules/accounts/accounts.service.ts';
import { accountCreateBody } from '../modules/accounts/accounts.schemas.ts';
import { createTransactionBody } from '../modules/transactions/transactions.schemas.ts';
import { postTransaction } from '../modules/transactions/transactions.service.ts';
import { todayInTimeZone, addDays } from '../lib/dates.ts';
import { getSettings } from '../modules/settings/settings.service.ts';

const args = new Set(process.argv.slice(2));
const MIN_PASSWORD_LENGTH = 10;

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const originalWrite = (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text: string) => {
        if (text.includes(question)) originalWrite.call(rl, text);
        else if (text.includes('\n') || text.includes('\r')) originalWrite.call(rl, text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function resolveCredentials(): Promise<{ username: string; password: string }> {
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    return { username: env.ADMIN_USERNAME.trim(), password: env.ADMIN_PASSWORD };
  }
  const username = (await ask('Administrator username: ')) || 'admin';
  const password = await ask('Administrator password (min 10 characters, hidden): ', true);
  const confirm = await ask('Confirm password: ', true);
  if (password !== confirm) throw new Error('The passwords do not match.');
  return { username, password };
}

function validateCredentials(username: string, password: string): void {
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new Error('Username must be 3-64 characters: letters, numbers, dot, underscore or hyphen.');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new Error(`Password must be between ${MIN_PASSWORD_LENGTH} and 200 characters.`);
  }
}

async function createOrResetAdmin(): Promise<void> {
  const existing = await prisma.adminUser.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });

  if (existing && !args.has('--reset-password')) {
    console.log(`An administrator ("${existing.username}") already exists. Nothing was changed.`);
    console.log('To set a new password, run: npm run seed -- --reset-password');
    return;
  }

  const { username, password } = await resolveCredentials();
  validateCredentials(username, password);
  const passwordHash = await hashPassword(password);

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: existing.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { adminUserId: existing.id } });
      await writeAudit(tx, { action: 'ADMIN_PASSWORD_RESET_CLI', entityType: 'AdminUser', entityId: existing.id });
    });
    console.log(`Password updated for "${existing.username}". All existing sessions were signed out.`);
    return;
  }

  const admin = await prisma.adminUser.create({ data: { username, passwordHash, role: 'ADMIN' } });
  await writeAudit(prisma, { action: 'ADMIN_CREATED', entityType: 'AdminUser', entityId: admin.id, actorId: admin.id });
  console.log(`Administrator "${username}" created.`);
}

async function addDemoData(): Promise<void> {
  const admin = await prisma.adminUser.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  if (!admin) throw new Error('Create the administrator first.');
  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);
  if ((await prisma.account.count()) > 0) {
    console.log('Demo data skipped: accounts already exist.');
    return;
  }

  // Inputs go through the same zod schemas the API uses, so the demo data follows the real rules.
  const customerInput = accountCreateBody.parse({
    name: '[DEMO] Sharma Traders',
    type: 'CUSTOMER',
    phone: '+91 98200 00001',
    email: 'demo.sharma@example.com',
    address: 'Demo address, Pune',
    openingBalance: '2500.00',
    openingBalanceSide: 'RECEIVABLE',
    notes: 'Demo record. Deactivate it from the app if not needed.',
  });
  const supplierInput = accountCreateBody.parse({
    name: '[DEMO] Iyer Stationers',
    type: 'SUPPLIER',
    phone: '+91 98200 00003',
    email: 'demo.iyer@example.com',
    address: 'Demo address, Pune',
    openingBalance: '1200.00',
    openingBalanceSide: 'PAYABLE',
    notes: 'Demo record. Deactivate it from the app if not needed.',
  });

  await prisma.$transaction(async (tx) => {
    const customer = await createAccountInTx(tx, customerInput, admin.id);
    await postTransaction(tx, createTransactionBody.parse({ accountId: customer.id, type: 'CREDIT_SALE', entryDate: addDays(today, -6), amount: '1800.00', referenceNumber: 'DM-001', notes: 'Demo invoice' }), admin.id, today);
    await postTransaction(tx, createTransactionBody.parse({ accountId: customer.id, type: 'PAYMENT_RECEIVED', entryDate: addDays(today, -2), amount: '1000.00', paymentMethod: 'UPI', referenceNumber: 'UPI-DEMO-1', notes: 'Demo payment' }), admin.id, today);

    const supplier = await createAccountInTx(tx, supplierInput, admin.id);
    await postTransaction(tx, createTransactionBody.parse({ accountId: supplier.id, type: 'CREDIT_PURCHASE', entryDate: addDays(today, -4), amount: '900.00', referenceNumber: 'PO-DEMO-7', notes: 'Demo purchase' }), admin.id, today);
    await postTransaction(tx, createTransactionBody.parse({ accountId: supplier.id, type: 'PAYMENT_MADE', entryDate: today, amount: '500.00', paymentMethod: 'BANK_TRANSFER', referenceNumber: 'NEFT-DEMO', notes: 'Demo payment made today' }), admin.id, today);
  });
  console.log('Demo customer and supplier added (names start with [DEMO]).');
}

async function main(): Promise<void> {
  await createOrResetAdmin();
  if (args.has('--demo')) await addDemoData();
}

main()
  .catch((error: unknown) => {
    console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
