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
  assert.equal(previous.body.transaction.approvalStatus, 'PENDING');
  assert.equal(previous.body.account.balance.amount, '0.00');
  assert.equal(previous.body.account.pendingSubmissionsCount, 1);
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
  assert.equal(dashboardPending.body.counts.pendingSubmissionsCount, 1);
  const approved = await write(`/transactions/${entryId}/approve`, admin, {}, 'approve-001');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.account.balance.amount, '0.10');
  assert.equal(approved.body.transaction.approvalStatus, 'APPROVED');
  const again = await write(`/transactions/${entryId}/approve`, admin, {}, 'approve-001');
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
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

test('reject/approve race decides at most once, and PIN/password resets revoke sessions', async () => {
  const pending = await write('/transactions', staff, { accountId: staffId, type: 'WITHDRAWAL',
    entryDate: today, amount: '1.00', optionName: 'Cash Withdrawal', bookId }, 'race-entry');
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  const txId = pending.body.transaction.id;
  const [approve, reject] = await Promise.all([
    write(`/transactions/${txId}/approve`, admin, {}, 'race-approve'),
    write(`/transactions/${txId}/reject`, admin, { reason: 'not valid' }, 'race-reject'),
  ]);
  assert.deepEqual([approve.status, reject.status].sort(), [200, 409]);
  const actual = await request(app).get(`/api/transactions/${txId}`).set('Cookie', admin);
  assert.ok(['APPROVED', 'REJECTED'].includes(actual.body.approvalStatus));
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
  assert.ok(audit.body.items.some((row: { action: string }) => row.action === 'TRANSACTION_APPROVED'));
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
