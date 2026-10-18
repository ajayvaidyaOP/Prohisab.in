import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { hash as argonHash } from '@node-rs/argon2';
import { createApp } from '../src/app.ts';
import { demoDatabase, prisma } from '../src/db/prisma.ts';
import { addDays } from '../src/lib/dates.ts';
import { seedDatabase } from '../src/scripts/seed.ts';
import { csvCell } from '../src/services/ledger.ts';
import { sha256Hex, stableStringify } from '../src/lib/security.ts';
import { FailureWindow } from '../src/lib/throttle.ts';
import { checkPostingDate, parseKind } from '../src/services/transactions.ts';
import { statements, migrationSql, BASELINE, NODE_SUPPORT } from '../src/scripts/migrate.ts';

const app = createApp();
let admin = '', staff = '', staffId = 0, bookId = 0, today = '', entryId = 0;
const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
const cookie = (response: request.Response) => String(response.headers['set-cookie']?.[0] || '').split(';')[0];
function write(path: string, auth: string, body: unknown, key?: string) {
  let req = request(app).post(`/api${path}`).set(csrf).set('Cookie', auth);
  if (key) req = req.set('Idempotency-Key', key);
  return req.send(body);
}

/** Column headings the Entries screen shows; every entry PDF must print the same ones. */
const ENTRY_COLUMNS = ['TIME (IST)', 'BOOK', 'STAFF', 'CUSTOMER ID', 'TYPE', 'AMOUNT',
  'BANK ACCOUNT', 'EDIT STATUS'];
/** How a label appears inside a PDF content stream: (text) with escaped brackets. */
const drawn = (label: string) => `(${label.replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;

before(async () => { await seedDatabase(prisma); });
after(async () => { await prisma.$disconnect(); await demoDatabase?.close(); });

test('same MySQL schema and migrations work in MariaDB WASM without losing rows', async () => {
  assert.ok(demoDatabase);
  assert.equal(statements(migrationSql(BASELINE)).length, 32);
  assert.equal(statements(migrationSql(NODE_SUPPORT)).length, 4);
  assert.equal(demoDatabase.query("SHOW TABLES LIKE 'transactions'").length, 1);
  assert.equal(demoDatabase.query("SHOW COLUMNS FROM users LIKE 'pin_hash'").length, 1);
  assert.equal(await prisma.user.count({ where: { role: 'ADMIN' } }), 1);
  await seedDatabase(prisma);
  assert.equal(await prisma.user.count({ where: { role: 'ADMIN' } }), 1);
});

test('PIN failure window throttles distributed guessing and recovers', () => {
  const bucket = new FailureWindow(3, 1_000);
  const t0 = 1_000_000;
  assert.equal(bucket.blocked(t0), false);
  bucket.record(t0);
  bucket.record(t0 + 100);
  bucket.record(t0 + 200);
  assert.equal(bucket.blocked(t0 + 300), true);
  assert.equal(bucket.retryAfterSeconds(t0 + 300), 1);
  // Once the oldest failure leaves the window, guessing is possible again.
  assert.equal(bucket.blocked(t0 + 1_201), false);
  bucket.record(t0 + 1_300);
  bucket.reset();
  assert.equal(bucket.blocked(t0 + 1_300), false);
});

test('cookie-only login, CSRF, origin and admin permissions', async () => {
  assert.equal((await request(app).get('/api/accounts')).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Admin@12345' })).status, 403);
  const result = await request(app).post('/api/auth/login').set(csrf)
    .send({ username: 'ADMIN', password: 'Admin@12345' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.user.role, 'ADMIN');
  assert.equal(result.body.sessionToken, undefined);
  admin = cookie(result);
  assert.match(admin, /^erp_session=/);
  assert.match(String(result.headers['set-cookie'][0]), /HttpOnly/);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', admin)).body.user.accountId, null);
  assert.equal((await request(app).post('/api/books').set(csrf).set('Origin', 'https://evil.invalid')
    .set('Cookie', admin).send({ name: 'Bad' })).status, 403);
});

test('HTTPS iframe preview gets a partitioned cookie, while localhost stays SameSite=Lax', async () => {
  const host = '5173-preview.e2b.app';
  const preview = await request(app).post('/api/auth/login').set('Host', host)
    .set('Origin', `https://${host}`).set(csrf)
    .send({ username: 'admin', password: 'Admin@12345' });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const setCookies: string[] = preview.headers['set-cookie'];
  const sessionCookie = setCookies.find((value) => /^erp_session=[A-Za-z0-9_-]{43};/.test(value));
  assert.ok(sessionCookie, JSON.stringify(setCookies));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /SameSite=None/);
  assert.match(sessionCookie, /Partitioned/);
  const rawCookie = sessionCookie.split(';')[0];
  const me = await request(app).get('/api/auth/me').set('Host', host).set('Cookie', rawCookie);
  assert.equal(me.status, 200, JSON.stringify(me.body));
  const logout = await request(app).post('/api/auth/logout').set('Host', host)
    .set('Origin', `https://${host}`).set(csrf).set('Cookie', rawCookie);
  assert.equal(logout.status, 204);
  assert.ok((logout.headers['set-cookie'] as string[]).some((value) => value.includes('Partitioned')));
  assert.equal((await request(app).get('/api/auth/me').set('Host', host).set('Cookie', rawCookie)).status, 401);

  const local = await request(app).post('/api/auth/login').set(csrf)
    .send({ username: 'admin', password: 'Admin@12345' });
  assert.equal(local.status, 200);
  const localCookie = String(local.headers['set-cookie'][0]);
  assert.match(localCookie, /SameSite=Lax/);
  assert.doesNotMatch(localCookie, /Partitioned|Secure/);
});

test('PIN staff, books, scoped access, back-date permission, and idempotent user creation', async () => {
  today = (await request(app).get('/api/settings').set('Cookie', admin)).body.today;
  const data = { name: 'Neha Staff', pin: '1234' };
  const created = await write('/accounts', admin, data, 'create-staff-001');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  staffId = created.body.account.id;
  assert.equal(created.body.account.hasPin, true);
  assert.equal(created.body.account.allowedBookIds.length, 0);
  const replay = await write('/accounts', admin, data, 'create-staff-001');
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.account.id, staffId);
  const storedKey = await prisma.idempotencyKey.findUnique({ where: {
    scope_keyHash: { scope: 'POST /api/accounts:user:1', keyHash: sha256Hex('create-staff-001') },
  } });
  assert.notEqual(storedKey?.requestHash, sha256Hex(stableStringify(data)));
  const wrongPayload = await write('/accounts', admin, { name: 'Different', pin: '7777' }, 'create-staff-001');
  assert.equal(wrongPayload.status, 409);
  assert.equal(wrongPayload.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  const book = await write('/books', admin, { name: 'Site Ledger' });
  assert.equal(book.status, 201, JSON.stringify(book.body));
  bookId = book.body.id;
  const linked = await request(app).put(`/api/accounts/${staffId}/books`).set(csrf).set('Cookie', admin).send([bookId]);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.deepEqual(linked.body.account.allowedBookIds, [bookId]);
  const pinLogin = await request(app).post('/api/auth/pin-login').set(csrf).send({ pin: '1234' });
  assert.equal(pinLogin.status, 200, JSON.stringify(pinLogin.body));
  staff = cookie(pinLogin);
  assert.equal(pinLogin.body.user.accountId, staffId);
  const pinPreview = await request(app).post('/api/auth/pin-login').set('Host', '5173-preview.e2b.app')
    .set('Origin', 'https://5173-preview.e2b.app').set(csrf).send({ pin: '1234' });
  assert.equal(pinPreview.status, 200);
  assert.ok((pinPreview.headers['set-cookie'] as string[]).some((value) => /Partitioned; SameSite=None/.test(value)));
  assert.equal((await request(app).get('/api/accounts').set('Cookie', staff)).status, 403);
  assert.equal((await request(app).get('/api/transactions').set('Cookie', staff)).status, 403);
  assert.equal((await request(app).get('/api/accounts/options').set('Cookie', staff)).status, 403);
  assert.equal((await request(app).get('/api/accounts/1/ledger').set('Cookie', staff)).status, 403);
  assert.equal((await request(app).get('/api/books').set('Cookie', staff)).body.length, 1);
  const baseEntry = { accountId: staffId, type: 'DEPOSIT', entryDate: today,
    amount: '0.10', optionName: 'Cash Deposit', bookId };
  assert.equal((await write('/transactions', staff, { ...baseEntry, accountId: 1 })).status, 403);
  assert.equal((await write('/transactions', staff, { ...baseEntry, optionName: 'Fabricated' })).status, 422);
  assert.equal((await write('/transactions', staff, { ...baseEntry, bookId: 999999 })).status, 404);
  assert.equal((await write('/transactions', staff, { ...baseEntry, bookId: null })).status, 403);
  assert.equal((await write('/transactions', staff, { ...baseEntry, entryDate: addDays(today, -1) })).status, 403);
  const dateGrant = await request(app).patch(`/api/accounts/${staffId}/back-date`).set(csrf).set('Cookie', admin)
    .send({ date: addDays(today, -1) });
  assert.equal(dateGrant.status, 200, JSON.stringify(dateGrant.body));
  assert.equal(dateGrant.body.account.backDateAllowedDate, addDays(today, -1));
  assert.equal((await write('/transactions', staff, { ...baseEntry, entryDate: addDays(today, -2) })).status, 403);
  const previous = await write('/transactions', staff, { ...baseEntry, entryDate: addDays(today, -1) }, 'prior-001');
  assert.equal(previous.status, 201, JSON.stringify(previous.body));
  entryId = previous.body.transaction.id;
  assert.equal(previous.body.transaction.approvalStatus, 'APPROVED');
  assert.equal(previous.body.account.balance.amount, '0.10');
  assert.equal(previous.body.account.pendingSubmissionsCount, 0);
});

test('existing Spring 64-character session cookies still authenticate and can be revoked', async () => {
  const legacyToken = 'a'.repeat(64);
  await prisma.session.create({ data: { id: sha256Hex(legacyToken), userId: BigInt(staffId),
    expiresAt: new Date(Date.now() + 60 * 60_000), lastSeenAt: new Date(), createdAt: new Date() } });
  const springCookie = `erp_session=${legacyToken}`;
  const me = await request(app).get('/api/auth/me').set('Cookie', springCookie);
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.user.accountId, staffId);
  assert.equal((await request(app).post('/api/auth/logout').set(csrf).set('Cookie', springCookie)).status, 204);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', springCookie)).status, 401);
});

test('approval, precise decimals, filtered reports, PDF/CSV and reversal', async () => {
  const dashboardPending = await request(app).get('/api/dashboard').set('Cookie', admin);
  assert.equal(dashboardPending.body.counts.pendingSubmissionsCount, 0);
  assert.equal((await write(`/transactions/${entryId}/approve`, admin, {}, 'approve-001')).status, 409);
  assert.equal((await write(`/transactions/${entryId}/reject`, admin, { reason: 'Too late' })).status, 409);
  const another = await write('/transactions', admin, {
    accountId: staffId, type: 'DEPOSIT', entryDate: today, amount: '0.20',
    optionName: 'Cash Deposit', bookId, detail: 'Second',
  }, 'admin-direct-001');
  assert.equal(another.status, 201, JSON.stringify(another.body));
  assert.equal(another.body.transaction.approvalStatus, 'APPROVED');
  assert.equal(another.body.account.balance.amount, '0.30');
  const ledger = await request(app).get(`/api/accounts/${staffId}/ledger?from=${today}`).set('Cookie', staff);
  assert.equal(ledger.status, 200, JSON.stringify(ledger.body));
  assert.equal(ledger.body.balanceBroughtForward.amount, '0.10');
  assert.equal(ledger.body.closingBalance.amount, '0.30');
  const report = await request(app).get(`/api/transactions/multi-report?userIds=${staffId}&bookId=${bookId}`)
    .set('Cookie', admin);
  assert.equal(report.status, 200);
  assert.equal(report.body.length, 2);
  assert.equal(report.body[0].bookName, 'Site Ledger');
  const overview = await request(app).get(`/api/dashboard?userId=${staffId}&bookId=${bookId}`).set('Cookie', admin);
  assert.equal(overview.body.userLedgerTotals.totalUserPaid, '0.30');
  assert.equal(overview.body.userLedgerTotals.totalPending, '0.30');
  for (const uri of [`/accounts/${staffId}/ledger.pdf`, '/dashboard/summary.pdf', '/transactions/multi-report.pdf']) {
    const response = await request(app).get(`/api${uri}`).set('Cookie', admin).buffer(true)
      .parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks))); });
    assert.equal(response.status, 200, uri);
    assert.match(response.headers['content-type'], /application\/pdf/);
    assert.equal((response.body as Buffer).subarray(0, 8).toString(), '%PDF-1.4');
    // Every entry export prints the same columns as the on-screen entry table.
    if (uri.endsWith('summary.pdf')) continue;
    const printed = (response.body as Buffer).toString('latin1');
    for (const column of ENTRY_COLUMNS) {
      assert.ok(printed.includes(drawn(column)), `${uri} is missing the ${column} column`);
    }
    // A single-user statement keeps its running balance next to those columns.
    assert.equal(printed.includes(drawn('BALANCE')), uri.includes('ledger.pdf'), uri);
  }
  const csv = await request(app).get(`/api/accounts/${staffId}/ledger.csv`).set('Cookie', admin);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Cash Deposit/);
  assert.equal((await request(app).get(`/api/accounts/${staffId}/ledger.pdf`).set('Cookie', staff)).status, 403);
  const reverse = await write(`/transactions/${another.body.transaction.id}/reversal`, admin,
    { reason: 'incorrect second amount' }, 'reverse-001');
  assert.equal(reverse.status, 200, JSON.stringify(reverse.body));
  assert.equal(reverse.body.account.balance.amount, '0.10');
  assert.equal(reverse.body.reversal.type, 'REVERSAL');
  const reverseReplay = await write(`/transactions/${another.body.transaction.id}/reversal`, admin,
    { reason: 'incorrect second amount' }, 'reverse-001');
  assert.equal(reverseReplay.status, 200);
  assert.equal(reverseReplay.body.replayed, true);
  assert.equal((await write(`/transactions/${another.body.transaction.id}/reversal`, admin,
    { reason: 'again' }, 'reverse-002')).status, 409);
  const withdrawal = await write('/transactions', admin, { accountId: staffId, type: 'WITHDRAWAL',
    entryDate: today, amount: '1.00', optionName: 'Cash Withdrawal', bookId });
  assert.equal(withdrawal.status, 201);
  assert.equal(withdrawal.body.account.balance.status, 'CREDIT');
  assert.equal(withdrawal.body.account.balance.amount, '0.90');
  const signedPdf = await request(app).get(`/api/accounts/${staffId}/ledger.pdf`).set('Cookie', admin)
    .buffer(true).parse((res, callback) => { const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks))); });
  assert.equal(signedPdf.status, 200);
  assert.match((signedPdf.body as Buffer).toString('latin1'), /Rs\. -0\.90/);
});

test('own entries can be edited within 1 hour; window, ownership and reversals lock edits', async () => {
  const created = await write('/transactions', staff, {
    accountId: staffId, type: 'DEPOSIT', entryDate: today, amount: '2.00',
    optionName: 'Cash Deposit', bookId, customerId: 'C-1721', bankDetails: 'GPay 98765',
  }, 'edit-create-001');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const editableId = created.body.transaction.id;

  // Ledger rows carry the portal history columns (book, staff, customer, bank).
  const ledger = await request(app).get(`/api/accounts/${staffId}/ledger?from=${today}`).set('Cookie', staff);
  assert.equal(ledger.status, 200);
  const mine = ledger.body.entries.find((row: { id: number }) => row.id === editableId);
  assert.equal(mine.bookName, 'Site Ledger');
  assert.equal(mine.staffName, 'Neha Staff');
  assert.equal(mine.customerId, 'C-1721');
  assert.equal(mine.bankDetails, 'GPay 98765');

  // The owner edits amount and bank details within the 1-hour window.
  const edited = await request(app).patch(`/api/transactions/${editableId}`).set(csrf).set('Cookie', staff)
    .send({ amount: '2.50', bankDetails: 'UPI 12345' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.transaction.amount, '2.50');
  assert.equal(edited.body.transaction.bankDetails, 'UPI 12345');
  // Prior approved deposits: 0.10 (back-dated staff entry) + 0.20 (admin entry) + this 2.50.
  assert.equal(edited.body.account.totalUserPaid, '2.80');

  // Invalid amounts never post.
  const badAmount = await request(app).patch(`/api/transactions/${editableId}`).set(csrf).set('Cookie', staff)
    .send({ amount: '0' });
  assert.equal(badAmount.status, 400);
  const badOption = await request(app).patch(`/api/transactions/${editableId}`).set(csrf).set('Cookie', staff)
    .send({ optionName: 'Fabricated' });
  assert.equal(badOption.status, 422);

  // Staff cannot edit another user's entry.
  const other = await request(app).post('/api/accounts').set(csrf).set('Cookie', admin)
    .send({ name: 'Other User', password: 'OtherPass123' });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  const foreign = await write('/transactions', admin, { accountId: other.body.account.id,
    type: 'DEPOSIT', entryDate: today, amount: '1.00', optionName: 'Cash Deposit' }, 'edit-other-001');
  assert.equal(foreign.status, 201);
  const foreignEdit = await request(app).patch(`/api/transactions/${foreign.body.transaction.id}`)
    .set(csrf).set('Cookie', staff).send({ amount: '9.00' });
  assert.equal(foreignEdit.status, 404);

  // Admins may edit any entry within the window.
  const adminEdit = await request(app).patch(`/api/transactions/${editableId}`).set(csrf).set('Cookie', admin)
    .send({ detail: 'adjusted by admin' });
  assert.equal(adminEdit.status, 200, JSON.stringify(adminEdit.body));
  assert.equal(adminEdit.body.transaction.detail, 'adjusted by admin');

  // Reversed entries are locked.
  const reversal = await write(`/transactions/${editableId}/reversal`, admin,
    { reason: 'correcting test entry' }, 'edit-reverse-001');
  assert.equal(reversal.status, 200, JSON.stringify(reversal.body));
  const reversedEdit = await request(app).patch(`/api/transactions/${editableId}`).set(csrf).set('Cookie', staff)
    .send({ amount: '5.00' });
  assert.equal(reversedEdit.status, 422);
  assert.equal(reversedEdit.body.error.code, 'ALREADY_REVERSED');

  // Outside the 1-hour window the entry locks for everyone.
  const fresh = await write('/transactions', staff, { accountId: staffId, type: 'DEPOSIT',
    entryDate: today, amount: '0.50', optionName: 'Cash Deposit', bookId }, 'edit-create-002');
  assert.equal(fresh.status, 201);
  await prisma.transaction.update({ where: { id: BigInt(fresh.body.transaction.id) },
    data: { createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
  const expired = await request(app).patch(`/api/transactions/${fresh.body.transaction.id}`)
    .set(csrf).set('Cookie', staff).send({ amount: '0.75' });
  assert.equal(expired.status, 422);
  assert.equal(expired.body.error.code, 'EDIT_WINDOW_EXPIRED');
  const expiredAdmin = await request(app).patch(`/api/transactions/${fresh.body.transaction.id}`)
    .set(csrf).set('Cookie', admin).send({ amount: '0.75' });
  assert.equal(expiredAdmin.status, 422);
  assert.equal(expiredAdmin.body.error.code, 'EDIT_WINDOW_EXPIRED');
});

test('staff withdrawals post immediately, legacy review cannot change them, and resets revoke sessions', async () => {
  const pending = await write('/transactions', staff, { accountId: staffId, type: 'WITHDRAWAL',
    entryDate: today, amount: '1.00', optionName: 'Cash Withdrawal', bookId }, 'race-entry');
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  const txId = pending.body.transaction.id;
  const [approve, reject] = await Promise.all([
    write(`/transactions/${txId}/approve`, admin, {}, 'race-approve'),
    write(`/transactions/${txId}/reject`, admin, { reason: 'not valid' }, 'race-reject'),
  ]);
  assert.equal(pending.body.transaction.approvalStatus, 'APPROVED');
  assert.deepEqual([approve.status, reject.status], [409, 409]);
  const actual = await request(app).get(`/api/transactions/${txId}`).set('Cookie', admin);
  assert.equal(actual.body.approvalStatus, 'APPROVED');
  const changes = await request(app).put(`/api/accounts/${staffId}/pin`).set(csrf).set('Cookie', admin)
    .send({ pin: '3456' });
  assert.equal(changes.status, 200, JSON.stringify(changes.body));
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', staff)).status, 401);
  assert.equal((await request(app).post('/api/auth/pin-login').set(csrf).send({ pin: '1234' })).status, 401);
  const newStaff = await request(app).post('/api/auth/pin-login').set(csrf).send({ pin: '3456' });
  assert.equal(newStaff.status, 200);
  staff = cookie(newStaff);
  const disabled = await write('/auth/change-password', staff,
    { currentPassword: 'a', newPassword: 'b', confirmPassword: 'b' });
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.error.code, 'PASSWORD_CHANGE_DISABLED');
  const reset = await write(`/accounts/${staffId}/reset-password`, admin,
    { newPassword: 'NewPass123', confirmPassword: 'NewPass123' });
  assert.equal(reset.status, 204);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', staff)).status, 401);
  const passwordLogin = await request(app).post('/api/auth/login').set(csrf)
    .send({ username: 'Neha Staff', password: 'NewPass123' });
  assert.equal(passwordLogin.status, 200, JSON.stringify(passwordLogin.body));
  staff = cookie(passwordLogin);
  const disable = await request(app).patch(`/api/accounts/${staffId}/status`).set(csrf).set('Cookie', admin)
    .send({ isActive: false });
  assert.equal(disable.status, 200);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', staff)).status, 401);
  const audit = await request(app).get('/api/audit-logs?pageSize=100').set('Cookie', admin);
  assert.equal(audit.status, 200);
  assert.ok(audit.body.items.some((row: { action: string }) => row.action === 'TRANSACTION_CREATED'));
});

test('legacy Spring plaintext PIN upgrades in place; Spring bcrypt and old Argon2 passwords work', async () => {
  const legacy = await prisma.user.create({ data: { name: 'Legacy Staff', nameNormalized: 'legacy staff',
    role: 'USER', passwordHash: await bcrypt.hash('OldPass123', 10), pin: '5678', accountCode: 'USR-LEGACY' } });
  const pin = await request(app).post('/api/auth/pin-login').set(csrf).send({ pin: '5678' });
  assert.equal(pin.status, 200, JSON.stringify(pin.body));
  const upgraded = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(upgraded.pin, null);
  assert.equal(upgraded.pinDigest?.length, 64);
  assert.ok(upgraded.pinHash?.startsWith('$2'));
  assert.equal((await request(app).post('/api/auth/login').set(csrf)
    .send({ username: 'Legacy Staff', password: 'OldPass123' })).status, 200);
  const oldNode = await prisma.user.create({ data: { name: 'Old Node User', nameNormalized: 'old node user',
    role: 'USER', passwordHash: await argonHash('ArgonPass123'), accountCode: 'USR-ARGON' } });
  assert.ok(oldNode.id > 0n);
  assert.equal((await request(app).post('/api/auth/login').set(csrf)
    .send({ username: 'Old Node User', password: 'ArgonPass123' })).status, 200);
  const before = await prisma.user.count();
  await seedDatabase(prisma);
  assert.equal(await prisma.user.count(), before);
});

test('idempotency keys expire after 24 hours and may be safely reused', async () => {
  const key = 'expired-key-001';
  const first = await write('/accounts', admin, { name: 'Expired Key Staff', password: 'Password123' }, key);
  assert.equal(first.status, 201);
  await prisma.idempotencyKey.update({
    where: { scope_keyHash: { scope: 'POST /api/accounts:user:1', keyHash: sha256Hex(key) } },
    data: { expiresAt: new Date('2000-01-01T00:00:00Z') },
  });
  const second = await write('/accounts', admin, { name: 'Reused Key Staff', password: 'Password123' }, key);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.notEqual(first.body.account.id, second.body.account.id);
  assert.equal(second.body.replayed, false);
  const stored = await prisma.idempotencyKey.findUnique({
    where: { scope_keyHash: { scope: 'POST /api/accounts:user:1', keyHash: sha256Hex(key) } },
  });
  assert.ok(stored?.expiresAt && stored.expiresAt.getTime() > Date.now());
});

test('money rules and CSV input hardening', () => {
  assert.equal(parseKind('CREDIT_SALE'), 'DEPOSIT');
  assert.equal(parseKind('PAYMENT_MADE'), 'WITHDRAWAL');
  assert.throws(() => parseKind('REVERSAL'));
  assert.throws(() => checkPostingDate('2099-01-01', '2026-10-17', 'ADMIN'));
  assert.throws(() => checkPostingDate('2026-10-16', '2026-10-17', 'USER', null));
  assert.doesNotThrow(() => checkPostingDate('2026-10-16', '2026-10-17', 'USER', '2026-10-16'));
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell('-0.20', false), '"-0.20"');
});

test('dashboard collection is grouped by ledger date/book and respects every filter', async () => {
  const collector = await prisma.user.create({ data: { name: 'Collection Staff', nameNormalized: 'collection staff',
    passwordHash: 'not-a-login', accountCode: 'USR-COLLECTION', role: 'USER' } });
  const firstBook = await prisma.book.create({ data: { name: 'Collection Book A', status: 'ARCHIVED' } });
  const secondBook = await prisma.book.create({ data: { name: 'Collection Book B' } });
  const earlier = addDays(today, -2), later = addDays(today, -1);
  const entry = (date: string, book: bigint | null, kind: string, amount: string, approvalStatus = 'APPROVED', userId = collector.id) => ({
    userId, bookId: book, entryDate: new Date(`${date}T00:00:00Z`), kind, amount, approvalStatus, optionName: 'Collection test',
  });
  await prisma.transaction.createMany({ data: [
    // More than ten entries: the breakdown must not be based on the recent-entry list.
    ...Array.from({ length: 12 }, () => entry(earlier, firstBook.id, 'DEPOSIT', '0.10')),
    entry(earlier, firstBook.id, 'WITHDRAWAL', '0.20'),
    entry(earlier, secondBook.id, 'DEPOSIT', '2.00'),
    entry(later, firstBook.id, 'DEPOSIT', '3.00'),
    entry(later, null, 'DEPOSIT', '4.00'),
    entry(earlier, firstBook.id, 'DEPOSIT', '999.00', 'PENDING'),
    entry(earlier, firstBook.id, 'DEPOSIT', '888.00', 'REJECTED'),
    entry(earlier, firstBook.id, 'DEPOSIT', '10.00', 'APPROVED', BigInt(staffId)),
  ] });
  const get = (filters: string) => request(app).get(`/api/dashboard?${filters}`).set('Cookie', admin);
  const result = await get(`from=${earlier}&to=${later}&userId=${collector.id}`);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.recentTransactions.length, 10);
  assert.deepEqual(result.body.collectionBreakdown, [
    { date: later, bookId: null, bookName: 'No book assigned', deposits: '4.00', withdrawals: '0.00', net: '4.00', entries: 1 },
    { date: later, bookId: Number(firstBook.id), bookName: firstBook.name, deposits: '3.00', withdrawals: '0.00', net: '3.00', entries: 1 },
    { date: earlier, bookId: Number(firstBook.id), bookName: firstBook.name, deposits: '1.20', withdrawals: '0.20', net: '1.00', entries: 13 },
    { date: earlier, bookId: Number(secondBook.id), bookName: secondBook.name, deposits: '2.00', withdrawals: '0.00', net: '2.00', entries: 1 },
  ]);
  assert.equal(result.body.userLedgerTotals.totalUserPaid, '10.20');
  assert.equal(result.body.userLedgerTotals.totalAdminPaid, '0.20');
  assert.equal(result.body.counts.ledgerEntries, 16);
  const single = await get(`from=${earlier}&to=${earlier}&bookId=${firstBook.id}&userId=${collector.id}`);
  assert.equal(single.status, 200);
  assert.deepEqual(single.body.collectionBreakdown, [result.body.collectionBreakdown[2]]);
  assert.equal(single.body.userLedgerTotals.totalUserPaid, '1.20');
  assert.equal(single.body.userLedgerTotals.totalPending, '1.00');
  const allUsers = await get(`from=${earlier}&to=${earlier}&bookId=${firstBook.id}`);
  assert.equal(allUsers.body.collectionBreakdown[0].deposits, '11.20');
  const empty = await get(`from=${today}&to=${today}&userId=${collector.id}`);
  assert.deepEqual(empty.body.collectionBreakdown, []);
  assert.equal(empty.body.userLedgerTotals.totalUserPaid, '0.00');
  const fromOnly = await get(`from=${later}&userId=${collector.id}`);
  assert.equal(fromOnly.body.collectionBreakdown.length, 2);
  const toOnly = await get(`to=${earlier}&userId=${collector.id}`);
  assert.equal(toOnly.body.collectionBreakdown.length, 2);
  assert.equal((await get(`from=${later}&to=${earlier}`)).status, 400);
  assert.equal((await get('from=2026-02-30')).status, 400);
  assert.equal((await get('bookId=999999')).status, 404);
  assert.equal((await request(app).get('/api/dashboard').set('Cookie', staff)).status, 401);
});

test('entries report applies dates/books/staff and totals the entire selection, not one page', async () => {
  const user = await prisma.user.create({ data: { name: 'Entries Collector', nameNormalized: 'entries collector',
    passwordHash: 'not-a-login', accountCode: 'USR-ENTRIES', role: 'USER' } });
  const book = await prisma.book.create({ data: { name: 'Entries Archive Book', status: 'ARCHIVED' } });
  const otherBook = await prisma.book.create({ data: { name: 'Entries Other Book' } });
  const earlier = addDays(today, -8), later = addDays(today, -7);
  const entry = (entryDate: string, amount: string, kind = 'DEPOSIT', approvalStatus = 'APPROVED', bookId = book.id, userId = user.id) => ({
    entryDate: new Date(`${entryDate}T00:00:00Z`), amount, kind, approvalStatus, bookId, userId,
    optionName: 'Cash Deposit', customerId: 'Customer-Report-901', bankDetails: 'Report Bank 901',
  });
  await prisma.transaction.createMany({ data: [
    ...Array.from({ length: 22 }, () => entry(earlier, '0.10')),
    entry(earlier, '0.20', 'WITHDRAWAL'), entry(later, '3.00'),
    entry(earlier, '4.00', 'DEPOSIT', 'APPROVED', otherBook.id),
    entry(earlier, '5.00', 'DEPOSIT', 'APPROVED', book.id, BigInt(staffId)),
    entry(earlier, '999.00', 'DEPOSIT', 'PENDING'), entry(earlier, '888.00', 'DEPOSIT', 'REJECTED'),
  ] });
  const get = (query: string) => request(app).get(`/api/transactions?${query}`).set('Cookie', admin);
  const filters = `from=${earlier}&to=${later}&bookId=${book.id}&accountId=${user.id}`;
  const result = await get(`${filters}&pageSize=10`);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.items.length, 10);
  assert.equal(result.body.pagination.total, 26);
  assert.deepEqual(result.body.summary, { deposits: '5.20', withdrawals: '0.20', net: '5.00', approvedEntries: 24 });
  const second = await get(`${filters}&pageSize=10&page=2`);
  assert.deepEqual(second.body.summary, result.body.summary);
  assert.notEqual(second.body.items[0].id, result.body.items[0].id);
  assert.ok(result.body.items.every((row: { bookId: number; account: { id: number } }) => row.bookId === Number(book.id) && row.account.id === Number(user.id)));
  const singleDay = await get(`from=${earlier}&to=${earlier}&bookId=${book.id}&accountId=${user.id}`);
  assert.deepEqual(singleDay.body.summary, { deposits: '2.20', withdrawals: '0.20', net: '2.00', approvedEntries: 23 });
  for (const search of ['Customer-Report-901', 'Report Bank 901', 'Entries Archive Book']) {
    const searched = await get(`${filters}&search=${encodeURIComponent(search)}`);
    assert.equal(searched.body.pagination.total, 26);
    assert.deepEqual(searched.body.summary, result.body.summary);
  }
  const pending = await get(`${filters}&approvalStatus=PENDING`);
  assert.equal(pending.body.pagination.total, 1);
  assert.deepEqual(pending.body.summary, { deposits: '0.00', withdrawals: '0.00', net: '0.00', approvedEntries: 0 });
  const withdrawal = await get(`${filters}&type=WITHDRAWAL`);
  assert.equal(withdrawal.body.pagination.total, 1);
  assert.equal(withdrawal.body.summary.net, '-0.20');
  const empty = await get(`from=${today}&to=${today}&bookId=${book.id}&accountId=${user.id}`);
  assert.equal(empty.body.pagination.total, 0);
  assert.equal(empty.body.summary.deposits, '0.00');
  const original = await prisma.transaction.findFirstOrThrow({ where: { userId: user.id, bookId: book.id, amount: '0.10' } });
  const reversal = await prisma.transaction.create({ data: { ...entry(earlier, '0.10', 'WITHDRAWAL'), reversalOfId: original.id } });
  await prisma.transaction.update({ where: { id: original.id }, data: { reversedById: reversal.id } });
  const reversed = await get(`${filters}&type=REVERSAL`);
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.pagination.total, 1);
  assert.equal(reversed.body.items[0].isReversal, true);
  assert.equal(reversed.body.summary.net, '-0.10');
  const withReversals = await get(filters);
  assert.equal(withReversals.body.summary.withdrawals, '0.30');
  const withoutReversals = await get(`${filters}&includeReversals=false`);
  assert.deepEqual(withoutReversals.body.summary, result.body.summary);
  assert.equal((await get(`${filters}&type=REVERSAL&includeReversals=false`)).body.pagination.total, 0);
  const pdf = await request(app).get(`/api/transactions/report.pdf?${filters}&type=WITHDRAWAL`).set('Cookie', admin).buffer(true)
    .parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks))); });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  const contents = (pdf.body as Buffer).toString();
  assert.ok(contents.startsWith('%PDF-1.4'));
  assert.match(contents, /ENTRIES & COLLECTION REPORT/);
  assert.match(contents, /Withdrawals: 0.30/);
  assert.match(contents, /Entries: 2/);
  assert.match(contents, /Customer-Report/);
  assert.match(contents, /Report Bank 901/);
  // Entry-table format: Time (IST) timestamps, Edit status and no separate description column.
  for (const column of ENTRY_COLUMNS) assert.ok(contents.includes(drawn(column)), column);
  assert.match(contents, /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)/);
  assert.ok(contents.includes(drawn('Original')));
  assert.ok(!contents.includes(drawn('DESCRIPTION')), 'report PDF should match the entry table columns');
  assert.equal((await get(`from=${later}&to=${earlier}`)).status, 400);
  assert.equal((await get('from=2026-02-30')).status, 400);
  assert.equal((await get('bookId=invalid')).status, 400);
  assert.equal((await request(app).get('/api/transactions/report.pdf')).status, 401);
});

test('combined staff report separates period collection from ledgers and matches its PDF summaries', async () => {
  const makeUser = (name: string, code: string, isActive = true) => prisma.user.create({ data: {
    name, nameNormalized: name.toLowerCase(), passwordHash: 'not-a-login', accountCode: code, role: 'USER', isActive,
  } });
  const a = await makeUser('Combined Staff A', 'USR-COMB-A');
  const b = await makeUser('Combined Staff B', 'USR-COMB-B');
  const inactive = await makeUser('Combined Inactive', 'USR-COMB-I', false);
  const archive = await prisma.book.create({ data: { name: 'Combined Archive', status: 'ARCHIVED' } });
  const online = await prisma.book.create({ data: { name: 'Combined Online' } });
  const from = addDays(today, -12), to = addDays(today, -11);
  const entry = (userId: bigint, date: string, bookId: bigint | null, kind: string, amount: string, approvalStatus = 'APPROVED') => ({
    userId, entryDate: new Date(`${date}T00:00:00Z`), bookId, kind, amount, approvalStatus,
    optionName: 'Collection test', customerId: 'Combined-C901', bankDetails: 'Combined Bank',
  });
  const original = await prisma.transaction.create({ data: entry(a.id, from, archive.id, 'DEPOSIT', '0.20') });
  await prisma.transaction.createMany({ data: [
    entry(a.id, from, archive.id, 'DEPOSIT', '0.10'),
    entry(a.id, from, archive.id, 'WITHDRAWAL', '0.05'),
    entry(a.id, from, archive.id, 'DEPOSIT', '999.00', 'PENDING'),
    entry(a.id, from, archive.id, 'DEPOSIT', '888.00', 'REJECTED'),
    entry(a.id, to, online.id, 'DEPOSIT', '4.00'),
    entry(b.id, from, archive.id, 'DEPOSIT', '2.00'),
    entry(b.id, from, null, 'WITHDRAWAL', '3.00'),
    entry(b.id, addDays(from, -1), archive.id, 'DEPOSIT', '10.00'),
  ] });
  const reversal = await prisma.transaction.create({ data: { ...entry(a.id, to, archive.id, 'WITHDRAWAL', '0.20'), reversalOfId: original.id } });
  await prisma.transaction.update({ where: { id: original.id }, data: { reversedById: reversal.id } });
  const filters = `from=${from}&to=${to}&userIds=${a.id},${b.id},${inactive.id}`;
  const get = (query: string) => request(app).get(`/api/transactions/multi-report?summary=true&${query}`).set('Cookie', admin);
  const result = await get(filters);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.summary, { deposits: '6.30', withdrawals: '3.25', net: '3.05',
    totalEntries: 9, approvedEntries: 7, pendingEntries: 1, rejectedEntries: 1, pendingAmount: '999.00' });
  const staffA = result.body.staffSummary.find((row: { userId: number }) => row.userId === Number(a.id));
  assert.equal(staffA.deposits, '4.30');
  assert.equal(staffA.withdrawals, '0.25');
  assert.equal(staffA.net, '4.05');
  assert.equal(staffA.totalEntries, 7);
  const zero = result.body.staffSummary.find((row: { userId: number }) => row.userId === Number(inactive.id));
  assert.equal(zero.deposits, '0.00');
  assert.equal(zero.totalEntries, 0);
  assert.equal(zero.isActive, false);
  assert.deepEqual(result.body.bookSummary.map((row: { name: string; net: string }) => [row.name, row.net]), [
    ['Combined Archive', '2.05'], ['Combined Online', '4.00'], ['No book assigned', '-3.00'],
  ]);
  const legacy = await request(app).get(`/api/transactions/multi-report?${filters}`).set('Cookie', admin);
  assert.deepEqual(legacy.body, result.body.rows);
  const onlyBook = await get(`${filters}&bookId=${archive.id}`);
  assert.equal(onlyBook.body.summary.deposits, '2.30');
  assert.equal(onlyBook.body.summary.withdrawals, '0.25');
  assert.equal(onlyBook.body.bookSummary.length, 1);
  const oneDay = await get(`from=${from}&to=${from}&userIds=${a.id}`);
  assert.equal(oneDay.body.summary.net, '0.25');
  assert.equal(oneDay.body.summary.pendingEntries, 1);
  const nextDay = await get(`from=${to}&to=${to}&userIds=${a.id}`);
  assert.equal(nextDay.body.summary.net, '3.80');
  const fromOnly = await get(`from=${to}&userIds=${a.id}`);
  assert.equal(fromOnly.body.summary.net, '3.80');
  const toOnly = await get(`to=${from}&userIds=${b.id}`);
  assert.equal(toOnly.body.summary.deposits, '12.00');
  const empty = await get(`from=${today}&to=${today}&userIds=${inactive.id}`);
  assert.equal(empty.body.rows.length, 0);
  assert.equal(empty.body.staffSummary.length, 1);
  assert.equal(empty.body.summary.net, '0.00');
  const allStaff = await get(`from=${from}&to=${to}&bookId=${online.id}`);
  assert.equal(allStaff.body.summary.deposits, '4.00');
  const pdf = await request(app).get(`/api/transactions/multi-report.pdf?${filters}`).set('Cookie', admin).buffer(true)
    .parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks))); });
  assert.equal(pdf.status, 200);
  const contents = (pdf.body as Buffer).toString();
  for (const text of ['%PDF-1.4', 'STAFF-WISE SUMMARY', 'BOOK-WISE SUMMARY', 'Combined Inactive',
    'Approved collection: 6.30', 'Period net: 3.05', 'Combined Bank', 'Combined-C901', 'Entries: 9']) {
    assert.ok(contents.includes(text), text);
  }
  assert.equal((await get(`from=${to}&to=${from}`)).status, 400);
  assert.equal((await get('userIds=invalid')).status, 400);
  assert.equal((await get('bookId=invalid')).status, 400);
  assert.equal((await request(app).get('/api/transactions/multi-report?summary=true')).status, 401);
});

test('staff can review any past history date without back-date permission, but only their own ledger', async () => {
  const own = await prisma.user.create({ data: { name: 'Portal History Staff', nameNormalized: 'portal history staff',
    passwordHash: await bcrypt.hash('PortalPass123', 10), accountCode: 'USR-PORTAL-H', role: 'USER' } });
  const other = await prisma.user.create({ data: { name: 'Other Portal Staff', nameNormalized: 'other portal staff',
    passwordHash: 'not-a-login', accountCode: 'USR-PORTAL-O', role: 'USER' } });
  const assignedBook = await prisma.book.create({ data: { name: 'Luxury Portal Online' } });
  await prisma.userBook.create({ data: { userId: own.id, bookId: assignedBook.id } });
  const past = addDays(today, -14);
  const row = (userId: bigint, kind: string, amount: string, approvalStatus = 'APPROVED') => ({
    userId, entryDate: new Date(`${past}T00:00:00Z`), bookId: assignedBook.id,
    kind, amount, approvalStatus, optionName: 'Cash Deposit',
  });
  await prisma.transaction.createMany({ data: [
    row(own.id, 'DEPOSIT', '0.10'), row(own.id, 'DEPOSIT', '0.20'), row(own.id, 'WITHDRAWAL', '0.05'),
    row(own.id, 'DEPOSIT', '999.00', 'PENDING'), row(own.id, 'DEPOSIT', '888.00', 'REJECTED'),
    row(other.id, 'DEPOSIT', '20.00'),
  ] });
  const login = await request(app).post('/api/auth/login').set(csrf)
    .send({ username: own.name, password: 'PortalPass123' });
  assert.equal(login.status, 200);
  const auth = cookie(login);
  const books = await request(app).get('/api/books').set('Cookie', auth);
  assert.deepEqual(books.body.map((book: { id: number }) => book.id), [Number(assignedBook.id)]);
  const result = await request(app).get(`/api/accounts/${own.id}/ledger?from=${past}&to=${past}`).set('Cookie', auth);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.account.backDateAllowedDate, null);
  assert.equal(result.body.pagination.total, 5);
  assert.deepEqual(result.body.totals, { increases: '0.30', decreases: '0.05', net: '0.25', entryCount: 3 });
  assert.equal(result.body.entries.some((entry: { amount: string }) => entry.amount === '20.00'), false);
  const period = await request(app).get(`/api/accounts/${own.id}/ledger?from=${past}&to=${today}`).set('Cookie', auth);
  assert.equal(period.body.totals.net, '0.25');
  const empty = await request(app).get(`/api/accounts/${own.id}/ledger?from=${today}&to=${today}`).set('Cookie', auth);
  assert.equal(empty.body.totals.net, '0.00');
  assert.equal((await request(app).get(`/api/accounts/${other.id}/ledger?from=${past}&to=${past}`).set('Cookie', auth)).status, 403);
  assert.equal((await request(app).get(`/api/accounts/${other.id}`).set('Cookie', auth)).status, 403);
  const deniedPost = await write('/transactions', auth, { accountId: Number(own.id), bookId: Number(assignedBook.id),
    type: 'DEPOSIT', entryDate: past, amount: '1.00', optionName: 'Cash Deposit' });
  assert.equal(deniedPost.status, 403);
  assert.equal((await request(app).get(`/api/accounts/${own.id}/ledger?from=${today}&to=${past}`).set('Cookie', auth)).status, 400);
});

test('direct posting, persisted edit status and audited deletion keep every total consistent', async () => {
  const created = await write('/accounts', admin, { name: 'Direct Entry Staff', pin: '6819' }, 'direct-staff-create');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const accountId = created.body.account.id;
  const login = await request(app).post('/api/auth/pin-login').set(csrf).send({ pin: '6819' });
  assert.equal(login.status, 200);
  const own = cookie(login);
  const post = (type: string, amount: string, key: string) => write('/transactions', own,
    { accountId, type, entryDate: today, amount, optionName: type === 'DEPOSIT' ? 'Cash Deposit' : 'Cash Withdrawal' }, key);
  const deposit = await post('DEPOSIT', '100.10', 'direct-deposit');
  const withdrawal = await post('WITHDRAWAL', '25.05', 'direct-withdrawal');
  assert.equal(deposit.status, 201);
  assert.equal(withdrawal.status, 201);
  assert.equal(withdrawal.body.transaction.approvalStatus, 'APPROVED');
  assert.equal(withdrawal.body.account.pendingBalance, '75.05');
  assert.equal(withdrawal.body.transaction.editedAt, null);
  const withdrawalId = withdrawal.body.transaction.id;
  const patch = (body: object) => request(app).patch(`/api/transactions/${withdrawalId}`)
    .set(csrf).set('Cookie', own).set('Idempotency-Key', 'direct-edit-key').send(body);
  const edited = await patch({ amount: '30.10', customerId: 'Grey 1399', bankDetails: 'Irshad S' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.ok(edited.body.transaction.editedAt);
  assert.equal(edited.body.account.pendingBalance, '70.00');
  assert.equal((await patch({ amount: '30.10', customerId: 'Grey 1399', bankDetails: 'Irshad S' })).body.replayed, true);
  assert.equal((await patch({ amount: '31.10' })).body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  const ledger = await request(app).get(`/api/accounts/${accountId}/ledger`).set('Cookie', own);
  const row = ledger.body.entries.find((entry: { id: number }) => entry.id === withdrawalId);
  assert.equal(row.editedAt, edited.body.transaction.editedAt);
  assert.equal(row.staffName, 'Direct Entry Staff');
  const dashboard = await request(app).get(`/api/dashboard?userId=${accountId}`).set('Cookie', admin);
  assert.equal(dashboard.body.pendingEntries.length, 0);
  assert.equal(dashboard.body.userLedgerTotals.totalPending, '70.00');
  const remove = (entry: number, auth = own, key = 'direct-delete') => request(app)
    .delete(`/api/transactions/${entry}`).set(csrf).set('Cookie', auth).set('Idempotency-Key', key);
  assert.equal((await request(app).delete(`/api/transactions/${withdrawalId}`).set('Cookie', own)).status, 403);
  assert.equal((await remove(entryId)).status, 404); // Another staff member's entry.
  const deleted = await remove(withdrawalId);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.account.pendingBalance, '100.10');
  assert.equal((await remove(withdrawalId)).body.replayed, true);
  assert.equal((await remove(withdrawalId, own, 'different-delete')).status, 404);
  assert.equal(await prisma.transaction.findUnique({ where: { id: BigInt(withdrawalId) } }), null);
  const logs = await prisma.auditLog.findMany({ where: { entityId: String(withdrawalId), action: 'TRANSACTION_DELETED' } });
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0].details!).amount, '30.10');
  const report = await request(app).get(`/api/transactions?accountId=${accountId}`).set('Cookie', admin);
  assert.equal(report.body.pagination.total, 1);
  assert.equal(report.body.summary.net, '100.10');
  const combined = await request(app).get(`/api/transactions/multi-report?summary=true&userIds=${accountId}`).set('Cookie', admin);
  assert.equal(combined.body.summary.net, '100.10');
  const afterDelete = await request(app).get(`/api/accounts/${accountId}/ledger`).set('Cookie', own);
  assert.equal(afterDelete.body.totals.net, '100.10');
  const adminDelete = await remove(deposit.body.transaction.id, admin, 'admin-delete-own');
  assert.equal(adminDelete.status, 200);
  assert.equal(adminDelete.body.account.pendingBalance, '0.00');

  const locked = await post('DEPOSIT', '4.00', 'locked-delete');
  const lockedId = locked.body.transaction.id;
  await prisma.transaction.update({ where: { id: BigInt(lockedId) }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } });
  assert.equal((await remove(lockedId, own, 'expired-delete')).body.error.code, 'EDIT_WINDOW_EXPIRED');
  assert.equal((await remove(lockedId, admin, 'expired-admin-delete')).body.error.code, 'EDIT_WINDOW_EXPIRED');
  const reversal = await write(`/transactions/${lockedId}/reversal`, admin, { reason: 'Testing linked protection' }, 'linked-protection');
  assert.equal(reversal.status, 200);
  assert.equal((await remove(lockedId, own, 'linked-delete')).body.error.code, 'REVERSAL_ENTRY');
  assert.equal((await remove(reversal.body.reversal.id, admin, 'reverse-delete')).body.error.code, 'REVERSAL_ENTRY');

  const inactive = await post('DEPOSIT', '2.00', 'inactive-delete');
  await prisma.user.update({ where: { id: BigInt(accountId) }, data: { isActive: false } });
  assert.equal((await remove(inactive.body.transaction.id, admin, 'inactive-remove')).body.error.code, 'ACCOUNT_INACTIVE');
});
