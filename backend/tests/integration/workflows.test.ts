import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, RUN, uniqueKey, todayInBusinessZone, addDaysIso, dbErrorMessage, ADMIN, type ApiResponse, Api } from './helpers.ts';

const app = await bootApp();
const today = todayInBusinessZone();
const yesterday = addDaysIso(today, -1);

let admin: Api;
let customerId = 0;
let customerCode = '';
let supplierId = 0;
let supplierCode = '';
let paymentId = 0;
let overpaymentId = 0;

function expectStatus(res: ApiResponse, status: number, code?: string): void {
  assert.equal(res.status, status, `expected ${status} but got ${res.status}: ${JSON.stringify(res.body)}`);
  if (code) assert.equal(res.body?.error?.code, code, JSON.stringify(res.body));
}

before(async () => {
  admin = app.api();
});
after(async () => {
  await app.close();
});

describe('1. authentication and access control', () => {
  test('wrong password is rejected with a generic message', async () => {
    const api = app.api();
    const res = await api.login(ADMIN.username, 'not-the-password-123');
    expectStatus(res, 401, 'UNAUTHORIZED');
    assert.equal(res.body.error.message, 'Invalid username or password.');
    assert.equal(res.setCookie, null);
  });

  test('correct password sets a hardened session cookie', async () => {
    const res = await admin.login();
    expectStatus(res, 200);
    assert.equal(res.body.user.username, ADMIN.username);
    assert.match(res.setCookie ?? '', /erp_session=[^;]+/);
    assert.match(res.setCookie ?? '', /HttpOnly/);
    assert.match(res.setCookie ?? '', /SameSite=Strict/);
    assert.equal(/password/i.test(JSON.stringify(res.body)), false, 'no password material in response');
  });

  test('every private API rejects requests without a session', async () => {
    const anon = app.api();
    for (const path of ['/api/accounts', '/api/dashboard', '/api/transactions', '/api/settings', '/api/audit-logs', '/api/auth/me']) {
      const res = await anon.get(path);
      expectStatus(res, 401, 'UNAUTHORIZED');
    }
  });

  test('state-changing requests without the X-Requested-With header are rejected', async () => {
    const res = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN.username, password: ADMIN.password }),
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as any).error.code, 'FORBIDDEN');
  });

  test('a cross-site Origin header is refused even when the custom header is present', async () => {
    const res = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://evil.example' },
      body: JSON.stringify({ username: ADMIN.username, password: ADMIN.password }),
    });
    assert.equal(res.status, 403);
  });

  test('malformed JSON and unknown fields are rejected with 400', async () => {
    const res = await app.api().call('POST', '/api/auth/login', { body: { username: ADMIN.username } });
    expectStatus(res, 400);
    const strict = await admin.post('/api/accounts', { name: 'Strict Test', type: 'CUSTOMER', openingBalance: '0', balance: '999' }, uniqueKey('strict'));
    expectStatus(strict, 400, 'VALIDATION_ERROR');
  });

  test('session survives a fresh GET /me and unknown routes return JSON 404', async () => {
    expectStatus(await admin.get('/api/auth/me'), 200);
    const missing = await admin.get('/api/nope');
    expectStatus(missing, 404, 'NOT_FOUND');
  });
});

describe('2. account creation and opening balances (workflows A and B)', () => {
  test('A: create a customer with an opening receivable', async () => {
    const res = await admin.post(
      '/api/accounts',
      { name: `Customer ${RUN}`, type: 'CUSTOMER', phone: '+91 90000 00001', email: 'cust@example.com', openingBalance: '1,000', openingBalanceSide: 'RECEIVABLE', notes: 'Test' },
      uniqueKey('acct'),
    );
    expectStatus(res, 201);
    const acc = res.body.account;
    customerId = acc.id;
    customerCode = acc.accountCode;
    assert.match(customerCode, /^CUS-\d{6}$/);
    assert.equal(acc.openingBalance, '1000.00');
    assert.equal(acc.balance.amount, '1000.00');
    assert.equal(acc.balance.side, 'RECEIVABLE');
    assert.equal(acc.balance.status, 'DUE');
    assert.equal(acc.isActive, true);
  });

  test('B: create a supplier with an opening payable', async () => {
    const res = await admin.post('/api/accounts', { name: `Supplier ${RUN}`, type: 'SUPPLIER', openingBalance: '1200.00', openingBalanceSide: 'PAYABLE' }, uniqueKey('acct'));
    expectStatus(res, 201);
    supplierId = res.body.account.id;
    supplierCode = res.body.account.accountCode;
    assert.match(supplierCode, /^SUP-\d{6}$/);
    assert.equal(res.body.account.balance.amount, '1200.00');
    assert.equal(res.body.account.balance.side, 'PAYABLE');
  });

  test('opening side must match the account type', async () => {
    const res = await admin.post('/api/accounts', { name: `Bad ${RUN}`, type: 'CUSTOMER', openingBalance: '10', openingBalanceSide: 'PAYABLE' }, uniqueKey('acct'));
    expectStatus(res, 422, 'OPENING_SIDE_MISMATCH');
  });

  test('negative or 3-decimal opening balances are rejected', async () => {
    expectStatus(await admin.post('/api/accounts', { name: `Neg ${RUN}`, type: 'CUSTOMER', openingBalance: '-5' }, uniqueKey('acct')), 400);
    expectStatus(await admin.post('/api/accounts', { name: `Dec ${RUN}`, type: 'CUSTOMER', openingBalance: '5.555' }, uniqueKey('acct')), 400);
  });

  test('a repeated create with the same Idempotency-Key does not create a second account', async () => {
    const key = uniqueKey('dup-acct');
    const body = { name: `Once ${RUN}`, type: 'CUSTOMER', openingBalance: '0' };
    const first = await admin.post('/api/accounts', body, key);
    const second = await admin.post('/api/accounts', body, key);
    expectStatus(first, 201);
    assert.equal(second.status, 201);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.account.id, first.body.account.id);
  });

  test('the same key with a different body is refused', async () => {
    const key = uniqueKey('reuse');
    expectStatus(await admin.post('/api/accounts', { name: `R1 ${RUN}`, type: 'CUSTOMER', openingBalance: '0' }, key), 201);
    const other = await admin.post('/api/accounts', { name: `R2 ${RUN}`, type: 'CUSTOMER', openingBalance: '0' }, key);
    expectStatus(other, 422, 'IDEMPOTENCY_KEY_REUSED');
  });

  test('a missing Idempotency-Key is rejected for writes', async () => {
    expectStatus(await admin.post('/api/accounts', { name: `NoKey ${RUN}`, type: 'CUSTOMER', openingBalance: '0' }), 400);
  });

  test('concurrent account creation yields unique server-generated codes', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => admin.post('/api/accounts', { name: `Parallel ${RUN} ${i}`, type: 'SUPPLIER', openingBalance: '0' }, uniqueKey('par'))),
    );
    results.forEach((r) => expectStatus(r, 201));
    const codes = new Set(results.map((r) => r.body.account.accountCode));
    assert.equal(codes.size, 8);
  });

  test('the account list supports search, type filter and pagination', async () => {
    const res = await admin.get(`/api/accounts?search=${encodeURIComponent(RUN)}&type=CUSTOMER&pageSize=1&page=1`);
    expectStatus(res, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.pagination.pageSize, 1);
    assert.ok(res.body.pagination.total >= 1);
    assert.equal(res.body.items[0].type, 'CUSTOMER');
  });

});

describe('3. customer transactions (workflow C and D)', () => {
  test('C: credit sale increases receivable', async () => {
    const res = await admin.post(
      '/api/transactions',
      { accountId: customerId, type: 'CREDIT_SALE', entryDate: yesterday, amount: '500.00', referenceNumber: 'INV-1001', notes: 'Goods' },
      uniqueKey('sale'),
    );
    expectStatus(res, 201);
    assert.equal(res.body.transaction.side, 'RECEIVABLE');
    assert.equal(res.body.transaction.direction, 'INCREASE');
    assert.equal(res.body.account.balance.amount, '1500.00');
  });

  test('D: payment received (UPI) decreases receivable; reference is stored', async () => {
    const res = await admin.post(
      '/api/transactions',
      { accountId: customerId, type: 'PAYMENT_RECEIVED', entryDate: today, amount: '300.00', paymentMethod: 'UPI', referenceNumber: 'UPI-REF-77' },
      uniqueKey('pay'),
    );
    expectStatus(res, 201);
    paymentId = res.body.transaction.id;
    assert.equal(res.body.transaction.direction, 'DECREASE');
    assert.equal(res.body.transaction.paymentMethod, 'UPI');
    assert.equal(res.body.account.balance.amount, '1200.00');
  });

  test('replaying the same request with the same key returns the stored response and posts nothing new', async () => {
    const key = uniqueKey('replay');
    const body = { accountId: customerId, type: 'PAYMENT_RECEIVED', entryDate: today, amount: '50.00', paymentMethod: 'CASH' };
    const first = await admin.post('/api/transactions', body, key);
    const second = await admin.post('/api/transactions', body, key);
    expectStatus(first, 201);
    assert.equal(second.status, 201);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.transaction.id, first.body.transaction.id);
    const acc = await admin.get(`/api/accounts/${customerId}`);
    assert.equal(acc.body.account.balance.amount, '1150.00', 'only one 50.00 payment was posted');
  });

  test('rejects a payment on a supplier account, a customer on the wrong side, and mismatched direction', async () => {
    expectStatus(await admin.post('/api/transactions', { accountId: customerId, type: 'PAYMENT_MADE', entryDate: today, amount: '10', paymentMethod: 'CASH' }, uniqueKey('x')), 422, 'TRANSACTION_TYPE_MISMATCH');
    expectStatus(await admin.post('/api/transactions', { accountId: supplierId, type: 'PAYMENT_RECEIVED', entryDate: today, amount: '10', paymentMethod: 'CASH' }, uniqueKey('x')), 422, 'TRANSACTION_TYPE_MISMATCH');
    expectStatus(await admin.post('/api/transactions', { accountId: customerId, type: 'PAYMENT_RECEIVED', direction: 'INCREASE', entryDate: today, amount: '10', paymentMethod: 'CASH' }, uniqueKey('x')), 422, 'POSTING_RULE_MISMATCH');
  });

  test('rejects missing or invalid accounts and future dates', async () => {
    expectStatus(await admin.post('/api/transactions', { accountId: 999999999, type: 'CREDIT_SALE', entryDate: today, amount: '10' }, uniqueKey('x')), 404);
    expectStatus(await admin.post('/api/transactions', { type: 'CREDIT_SALE', entryDate: today, amount: '10' }, uniqueKey('x')), 400);
    expectStatus(await admin.post('/api/transactions', { accountId: customerId, type: 'CREDIT_SALE', entryDate: addDaysIso(today, 1), amount: '10' }, uniqueKey('x')), 422, 'FUTURE_DATE');
    expectStatus(await admin.post('/api/transactions', { accountId: customerId, type: 'CREDIT_SALE', entryDate: today, amount: '0' }, uniqueKey('x')), 400);
  });

  test('overpayment is shown explicitly as a credit balance (never clamped)', async () => {
    const res = await admin.post('/api/transactions', { accountId: customerId, type: 'PAYMENT_RECEIVED', entryDate: today, amount: '1500.00', paymentMethod: 'BANK_TRANSFER', referenceNumber: 'NEFT-OVER' }, uniqueKey('over'));
    expectStatus(res, 201);
    overpaymentId = res.body.transaction.id;
    assert.equal(res.body.account.balance.amount, '-350.00');
    assert.equal(res.body.account.balance.status, 'CREDIT');
  });

  test('a payment to an inactive account is refused; reactivation restores posting', async () => {
    const created = await admin.post('/api/accounts', { name: `Inactive ${RUN}`, type: 'CUSTOMER', openingBalance: '100' }, uniqueKey('ina'));
    const id = created.body.account.id;
    const deactivated = await admin.patch(`/api/accounts/${id}/status`, { isActive: false });
    expectStatus(deactivated, 200);
    assert.equal(deactivated.body.account.isActive, false);
    expectStatus(await admin.post('/api/transactions', { accountId: id, type: 'CREDIT_SALE', entryDate: today, amount: '10' }, uniqueKey('ina')), 422, 'ACCOUNT_INACTIVE');
    expectStatus(await admin.patch(`/api/accounts/${id}/status`, { isActive: true }), 200);
    expectStatus(await admin.post('/api/transactions', { accountId: id, type: 'CREDIT_SALE', entryDate: today, amount: '10' }, uniqueKey('ina')), 201);
  });

  test('the opening balance cannot change after transactions exist; the type cannot change either', async () => {
    const lockedOpening = await admin.patch(`/api/accounts/${customerId}`, { openingBalance: '999.00' });
    expectStatus(lockedOpening, 422);
    const typeChange = await admin.patch(`/api/accounts/${customerId}`, { type: 'SUPPLIER' });
    expectStatus(typeChange, 422);
    const notesOnly = await admin.patch(`/api/accounts/${customerId}`, { notes: 'Updated note' });
    expectStatus(notesOnly, 200);
  });
});

describe('4. supplier transactions (workflows E and F)', () => {
  test('E: credit purchase increases payable', async () => {
    const res = await admin.post('/api/transactions', { accountId: supplierId, type: 'CREDIT_PURCHASE', entryDate: today, amount: '100.00', referenceNumber: 'PO-9' }, uniqueKey('buy'));
    expectStatus(res, 201);
    assert.equal(res.body.transaction.side, 'PAYABLE');
    assert.equal(res.body.account.balance.amount, '1300.00');
  });

  test('F: payment made decreases payable', async () => {
    const res = await admin.post('/api/transactions', { accountId: supplierId, type: 'PAYMENT_MADE', entryDate: today, amount: '50.00', paymentMethod: 'CASH' }, uniqueKey('paid'));
    expectStatus(res, 201);
    assert.equal(res.body.transaction.direction, 'DECREASE');
    assert.equal(res.body.account.balance.amount, '1250.00');
    assert.equal(res.body.account.balances.receivable, '0.00', 'receivable and payable are never combined');
  });

  test('payment method is required for payments but not for credit sales', async () => {
    expectStatus(await admin.post('/api/transactions', { accountId: supplierId, type: 'PAYMENT_MADE', entryDate: today, amount: '5' }, uniqueKey('nm')), 400);
  });
});

describe('5. ledger view, statement and CSV', () => {
  test('ledger shows opening, running balance after every entry, and the closing balance', async () => {
    const res = await admin.get(`/api/accounts/${customerId}/ledger?pageSize=50`);
    expectStatus(res, 200);
    const body = res.body;
    assert.equal(body.openingBalance.amount, '1000.00');
    assert.equal(body.openingBalance.side, 'RECEIVABLE');
    const running = body.entries.map((e: any) => e.runningBalance);
    // opening 1000 -> sale 500 (1500) -> payment 300 (1200) -> payment 50 (1150) -> overpayment 1500 (-350)
    assert.deepEqual(running, ['1500.00', '1200.00', '1150.00', '-350.00']);
    assert.equal(body.closingBalance.amount, '-350.00');
    assert.equal(body.closingBalance.status, 'CREDIT');
    assert.equal(body.totals.increases, '500.00');
    assert.equal(body.totals.decreases, '1850.00');
    assert.equal(body.totals.net, '-1350.00');
  });

  test('date range: brought-forward balance and closing balance are correct for the period', async () => {
    const res = await admin.get(`/api/accounts/${customerId}/ledger?from=${today}&to=${today}&pageSize=50`);
    expectStatus(res, 200);
    assert.equal(res.body.balanceBroughtForward.amount, '1500.00', 'balance after yesterday sale');
    assert.equal(res.body.closingBalance.amount, '-350.00');
    // Entries dated today: UPI payment 300, cash payment 50, overpayment 1500
    assert.deepEqual(res.body.entries.map((e: any) => e.runningBalance), ['1200.00', '1150.00', '-350.00']);
  });

  test('search filters displayed rows by reference', async () => {
    const res = await admin.get(`/api/accounts/${customerId}/ledger?search=UPI-REF-77`);
    expectStatus(res, 200);
    assert.equal(res.body.entries.length, 1);
    assert.equal(res.body.entries[0].referenceNumber, 'UPI-REF-77');
  });

  test('statement endpoint returns the same closing balance', async () => {
    const res = await admin.get(`/api/accounts/${customerId}/statement`);
    expectStatus(res, 200);
    assert.equal(res.body.closingBalance.amount, '-350.00');
  });

  test('CSV export has a header, correct amounts and neutralises spreadsheet formulas', async () => {
    await admin.post('/api/transactions', { accountId: customerId, type: 'CREDIT_SALE', entryDate: today, amount: '1.00', notes: '=HYPERLINK("http://evil")', referenceNumber: 'CSV,1' }, uniqueKey('csv'));
    const res = await admin.call('GET', `/api/accounts/${customerId}/ledger.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="ledger-CUS-/);
    const csv = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert.match(csv, /Entry ID,Date,Description,Reference,Payment method,Notes,Increase,Decrease,Running balance,Reversed/);
    assert.match(csv, /500\.00/);
    assert.match(csv, /'=HYPERLINK/);
    assert.match(csv, /"CSV,1"/);
  });
});

describe('6. reversals (corrections never edit posted entries)', () => {
  test('reversing the overpayment restores the balance and the original row is untouched', async () => {
    const res = await admin.post(`/api/transactions/${overpaymentId}/reversal`, { reason: 'Entered twice by mistake' }, uniqueKey('rev'));
    expectStatus(res, 201);
    assert.equal(res.body.reversal.type, 'REVERSAL');
    assert.equal(res.body.reversal.reversalOfId, overpaymentId);
    assert.equal(res.body.reversal.direction, 'INCREASE', 'opposite of the original DECREASE');
    // 1150 before the overpayment, -349 after it, +1500 back from the reversal, and the 1.00 CSV sale is included
    assert.equal(res.body.account.balance.amount, '1151.00');

    const original = await admin.get(`/api/transactions/${overpaymentId}`);
    expectStatus(original, 200);
    assert.equal(original.body.transaction.amount, '1500.00');
    assert.equal(original.body.transaction.direction, 'DECREASE');
    assert.equal(original.body.transaction.isReversed, true);
  });

  test('an entry can be reversed only once', async () => {
    const second = await admin.post(`/api/transactions/${overpaymentId}/reversal`, { reason: 'Again' }, uniqueKey('rev2'));
    expectStatus(second, 409, 'ALREADY_REVERSED');
  });

  test('a reversal cannot itself be reversed', async () => {
    const list = await admin.get(`/api/transactions?type=REVERSAL&accountId=${customerId}`);
    const reversalId = list.body.items[0].id;
    expectStatus(await admin.post(`/api/transactions/${reversalId}/reversal`, { reason: 'Nope' }, uniqueKey('rr')), 422, 'CANNOT_REVERSE_REVERSAL');
  });

  test('reversal reason is required and the reversal date cannot precede the original', async () => {
    expectStatus(await admin.post(`/api/transactions/${paymentId}/reversal`, { reason: 'x' }, uniqueKey('rv')), 400);
    expectStatus(
      await admin.post(`/api/transactions/${paymentId}/reversal`, { reason: 'Wrong date', entryDate: addDaysIso(today, -30) }, uniqueKey('rv')),
      422,
      'REVERSAL_DATE_BEFORE_ORIGINAL',
    );
  });

  test('concurrent reversals of one entry: exactly one succeeds', async () => {
    const created = await admin.post('/api/transactions', { accountId: customerId, type: 'PAYMENT_RECEIVED', entryDate: today, amount: '25.00', paymentMethod: 'CASH' }, uniqueKey('race'));
    const id = created.body.transaction.id;
    const results = await Promise.all(Array.from({ length: 5 }, () => admin.post(`/api/transactions/${id}/reversal`, { reason: 'Concurrent test' }, uniqueKey('race-rev'))));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
  });

  test('the audit log records postings and reversals', async () => {
    const res = await admin.get('/api/audit-logs?pageSize=100');
    expectStatus(res, 200);
    const actions = res.body.items.map((i: any) => i.action);
    assert.ok(actions.includes('LEDGER_ENTRY_REVERSED'));
    assert.ok(actions.includes('LEDGER_ENTRY_CREATED'));
    assert.ok(actions.includes('ACCOUNT_CREATED'));
    const reversal = res.body.items.find((i: any) => i.action === 'LEDGER_ENTRY_REVERSED');
    assert.equal(reversal.actor, ADMIN.username);
    assert.ok(reversal.details.reason);
  });
});

describe('7. concurrent postings keep balances exact', () => {
  test('ten parallel payments of 10.00 on one account all apply exactly once', async () => {
    const created = await admin.post('/api/accounts', { name: `Parallel pay ${RUN}`, type: 'CUSTOMER', openingBalance: '500.00', openingBalanceSide: 'RECEIVABLE' }, uniqueKey('pp'));
    const id = created.body.account.id;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => admin.post('/api/transactions', { accountId: id, type: 'PAYMENT_RECEIVED', entryDate: today, amount: '10.00', paymentMethod: 'UPI' }, uniqueKey('pp-tx'))),
    );
    results.forEach((r) => expectStatus(r, 201));
    const after = await admin.get(`/api/accounts/${id}`);
    assert.equal(after.body.account.balance.amount, '400.00');
    assert.equal(after.body.account.entryCount, 10);
  });
});

describe('8. dashboard totals match an independent calculation', () => {
  test('receivable/payable totals, today payments and counts agree with the database', async () => {
    const dash = await admin.get('/api/dashboard');
    expectStatus(dash, 200);
    assert.equal(dash.body.today, today);

    const { prisma } = app;
    const accounts = await prisma.account.findMany({ select: { id: true, type: true, isActive: true, openingBalance: true, openingBalanceSide: true } });
    const entries = await prisma.ledgerEntry.findMany({ select: { accountId: true, side: true, direction: true, amount: true, type: true, entryDate: true } });
    const cents = (v: { toString(): string }) => Math.round(Number(v.toString()) * 100);
    let receivable = 0;
    let payable = 0;
    for (const a of accounts) {
      if (a.openingBalanceSide === 'RECEIVABLE') receivable += cents(a.openingBalance);
      else payable += cents(a.openingBalance);
    }
    for (const e of entries) {
      const sign = e.direction === 'INCREASE' ? 1 : -1;
      if (e.side === 'RECEIVABLE') receivable += sign * cents(e.amount);
      else payable += sign * cents(e.amount);
    }
    const fmt = (c: number) => (c / 100).toFixed(2);
    assert.equal(dash.body.receivables.total, fmt(receivable));
    assert.equal(dash.body.payables.total, fmt(payable));

    const todayIso = today;
    const paidToday = entries.filter((e) => e.type === 'PAYMENT_MADE' && e.entryDate.toISOString().slice(0, 10) === todayIso);
    const receivedToday = entries.filter((e) => e.type === 'PAYMENT_RECEIVED' && e.entryDate.toISOString().slice(0, 10) === todayIso);
    assert.equal(dash.body.todayPayments.paid, fmt(paidToday.reduce((s, e) => s + cents(e.amount), 0)));
    assert.equal(dash.body.todayPayments.received, fmt(receivedToday.reduce((s, e) => s + cents(e.amount), 0)));
    assert.equal(dash.body.counts.activeCustomers, accounts.filter((a) => a.type === 'CUSTOMER' && a.isActive).length);
    assert.equal(dash.body.counts.activeSuppliers, accounts.filter((a) => a.type === 'SUPPLIER' && a.isActive).length);
    assert.equal(dash.body.counts.ledgerEntries, entries.length);
    assert.ok(dash.body.recentTransactions.length <= 10);
    assert.ok(dash.body.outstandingAccounts.length <= 10);
  });
});

describe('9. settings, password change and logout', () => {
  test('settings are readable and updatable; invalid time zones are refused', async () => {
    const current = await admin.get('/api/settings');
    expectStatus(current, 200);
    assert.equal(current.body.business.timezone, process.env.APP_TIMEZONE);
    const editable = {
      businessName: `Ledger Co ${RUN}`,
      businessAddress: 'Pune',
      businessPhone: null,
      businessEmail: 'owner@example.com',
      currencySymbol: '₹',
      timezone: current.body.business.timezone,
    };
    const ok = await admin.put('/api/settings', editable);
    expectStatus(ok, 200);
    assert.equal(ok.body.business.businessName, editable.businessName);
    const unknownField = await admin.put('/api/settings', { ...editable, updatedAt: '2000-01-01' });
    expectStatus(unknownField, 400);
    expectStatus(await admin.put('/api/settings', { ...editable, timezone: 'Mars/Olympus' }), 400);
  });

  test('password change requires the correct current password and signs out other sessions', async () => {
    const other = app.api();
    expectStatus(await other.login(), 200);
    expectStatus(await admin.post('/api/settings/password', { currentPassword: 'wrong-wrong-1', newPassword: 'NewPassword-2026' }), 422, 'INVALID_CURRENT_PASSWORD');
    expectStatus(await admin.post('/api/settings/password', { currentPassword: ADMIN.password, newPassword: 'NewPassword-2026' }), 204);
    expectStatus(await other.get('/api/auth/me'), 401);
    expectStatus(await admin.get('/api/auth/me'), 200);
    // Restore the known test password for later runs.
    expectStatus(await admin.post('/api/settings/password', { currentPassword: 'NewPassword-2026', newPassword: ADMIN.password }), 204);
  });

  test('logout ends the session on the server, not only in the browser', async () => {
    const session = app.api();
    expectStatus(await session.login(), 200);
    const oldCookie = session.cookie;
    expectStatus(await session.call('POST', '/api/auth/logout'), 204);
    expectStatus(await session.call('GET', '/api/auth/me', { cookie: oldCookie }), 401);
  });
});

describe('10. database safeguards hold even for direct SQL', () => {
  test('ledger rows cannot be updated or deleted through Prisma or raw SQL', async () => {
    const { prisma } = app;
    const row = await prisma.ledgerEntry.findFirstOrThrow({ orderBy: { id: 'asc' } });
    await assert.rejects(prisma.ledgerEntry.update({ where: { id: row.id }, data: { amount: '1.00' } }), (e: unknown) => /immutable/.test(dbErrorMessage(e)));
    await assert.rejects(prisma.$executeRaw`DELETE FROM LedgerEntry WHERE id = ${row.id}`, (e: unknown) => /cannot be deleted/.test(dbErrorMessage(e)));
    await assert.rejects(prisma.$executeRaw`UPDATE LedgerEntry SET notes = 'x' WHERE id = ${row.id}`, (e: unknown) => /immutable/.test(dbErrorMessage(e)));
  });

  test('audit rows are append-only at the database level', async () => {
    const { prisma } = app;
    const row = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'asc' } });
    await assert.rejects(prisma.$executeRaw`DELETE FROM AuditLog WHERE id = ${row.id}`, (e: unknown) => /append-only/.test(dbErrorMessage(e)));
  });

  test('a non-positive amount or a wrong side is rejected by the insert trigger', async () => {
    const { prisma } = app;
    const account = await prisma.account.findFirstOrThrow({ where: { type: 'CUSTOMER' } });
    await assert.rejects(
      prisma.ledgerEntry.create({ data: { accountId: account.id, entryDate: new Date(`${today}T00:00:00Z`), type: 'CREDIT_SALE', side: 'RECEIVABLE', direction: 'INCREASE', amount: '-1.00' } }),
      (e: unknown) => /greater than zero/.test(dbErrorMessage(e)),
    );
    await assert.rejects(
      prisma.ledgerEntry.create({ data: { accountId: account.id, entryDate: new Date(`${today}T00:00:00Z`), type: 'PAYMENT_MADE', side: 'PAYABLE', direction: 'DECREASE', amount: '1.00' } }),
      (e: unknown) => /side does not match/.test(dbErrorMessage(e)),
    );
    await assert.rejects(
      prisma.account.create({ data: { accountCode: `TMP-${RUN}-x`, name: 'Neg open', type: 'CUSTOMER', openingBalance: '-1.00', openingBalanceSide: 'RECEIVABLE' } }),
      (e: unknown) => /cannot be negative/.test(dbErrorMessage(e)),
    );
  });
});
