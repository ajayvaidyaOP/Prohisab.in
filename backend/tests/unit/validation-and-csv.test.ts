import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransactionBody, reverseBody } from '../../src/modules/transactions/transactions.schemas.ts';
import { accountCreateBody } from '../../src/modules/accounts/accounts.schemas.ts';
import { passwordChangeBody, settingsUpdateBody } from '../../src/modules/settings/settings.schemas.ts';
import { csvCell } from '../../src/modules/ledger/ledger.service.ts';
import { readIdempotencyKey } from '../../src/lib/idempotency.ts';

const base = { accountId: 1, type: 'PAYMENT_RECEIVED', entryDate: '2026-10-15', amount: '100', paymentMethod: 'CASH' };

test('transaction body accepts a valid payment and normalizes the amount', () => {
  const parsed = createTransactionBody.parse({ ...base, amount: '1,000.5' });
  assert.equal(parsed.amount, '1000.50');
});

test('transaction body rejects zero, negative, 3-decimal and non-numeric amounts', () => {
  for (const amount of ['0', '-10', '10.555', 'ten']) {
    assert.equal(createTransactionBody.safeParse({ ...base, amount }).success, false, amount);
  }
});

test('transaction body rejects unknown types, bad dates and missing payment method for payments', () => {
  assert.equal(createTransactionBody.safeParse({ ...base, type: 'REVERSAL' }).success, false);
  assert.equal(createTransactionBody.safeParse({ ...base, type: 'DELETE_ALL' }).success, false);
  assert.equal(createTransactionBody.safeParse({ ...base, entryDate: '2026-02-30' }).success, false);
  const noMethod = createTransactionBody.safeParse({ ...base, paymentMethod: undefined });
  assert.equal(noMethod.success, false);
});

test('credit sales do not require a payment method', () => {
  const sale = createTransactionBody.safeParse({ accountId: 1, type: 'CREDIT_SALE', entryDate: '2026-10-15', amount: '50' });
  assert.equal(sale.success, true);
});

test('transaction body rejects unknown fields (no client-supplied balances)', () => {
  assert.equal(createTransactionBody.safeParse({ ...base, balance: '999999' }).success, false);
  assert.equal(createTransactionBody.safeParse({ ...base, runningBalance: '1' }).success, false);
});

test('side/direction are optional echoes but any other values are rejected', () => {
  assert.equal(createTransactionBody.safeParse({ ...base, side: 'PAYABLE' }).success, true);
  assert.equal(createTransactionBody.safeParse({ ...base, direction: 'SIDEWAYS' }).success, false);
});

test('reversal requires a meaningful reason', () => {
  assert.equal(reverseBody.safeParse({ reason: 'x' }).success, false);
  assert.equal(reverseBody.safeParse({ reason: 'Duplicate entry' }).success, true);
});

test('account creation: opening balance must be non-negative and account type is required', () => {
  const ok = accountCreateBody.safeParse({ name: 'Acme', type: 'CUSTOMER', openingBalance: '0' });
  assert.equal(ok.success, true);
  assert.equal(accountCreateBody.safeParse({ name: 'Acme', type: 'CUSTOMER', openingBalance: '-1' }).success, false);
  assert.equal(accountCreateBody.safeParse({ name: 'Acme', type: 'EMPLOYEE', openingBalance: '0' }).success, false);
  assert.equal(accountCreateBody.safeParse({ name: '', type: 'SUPPLIER', openingBalance: '0' }).success, false);
});

test('password change: new password needs 10+ characters and must differ from the current one', () => {
  assert.equal(passwordChangeBody.safeParse({ currentPassword: 'old-password-1', newPassword: 'short' }).success, false);
  assert.equal(passwordChangeBody.safeParse({ currentPassword: 'same-password-1', newPassword: 'same-password-1' }).success, false);
  assert.equal(passwordChangeBody.safeParse({ currentPassword: 'old-password-1', newPassword: 'new-password-2' }).success, true);
});

test('settings reject invalid time zones and malformed email', () => {
  const base = { businessName: 'Demo Traders', currencySymbol: '₹', timezone: 'Asia/Kolkata' };
  assert.equal(settingsUpdateBody.safeParse(base).success, true);
  assert.equal(settingsUpdateBody.safeParse({ ...base, timezone: 'Mars/Olympus' }).success, false);
  assert.equal(settingsUpdateBody.safeParse({ ...base, businessEmail: 'not-an-email' }).success, false);
});

test('CSV cells are quoted and text fields are protected against formula injection', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x")', { textual: true }), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1', { textual: true }), "'+1");
  assert.equal(csvCell('@cmd', { textual: true }), "'@cmd");
  assert.equal(csvCell('1234.50'), '1234.50');
});

test('idempotency key must be a safe token', () => {
  assert.equal(readIdempotencyKey('0f8fad5b-d9cb-469f-a165-70867728950e'), '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.throws(() => readIdempotencyKey(undefined));
  assert.throws(() => readIdempotencyKey('short'));
  assert.throws(() => readIdempotencyKey('has spaces in it'));
});
