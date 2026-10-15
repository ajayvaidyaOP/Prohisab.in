import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, formatMoney, parseMoneyInput } from '../../src/lib/money.ts';
import { isValidIsoDate, todayInTimeZone, addDays, isoDateToDbDate, dbDateToIso } from '../../src/lib/dates.ts';
import { stableStringify } from '../../src/lib/security.ts';

test('money arithmetic is exact (no floating point drift)', () => {
  assert.equal(formatMoney(money('0.1').plus('0.2')), '0.30');
  assert.equal(formatMoney(money('1000000.10').plus('0.20')), '1000000.30');
  assert.equal(money('0.1').plus(0.2).toFixed(2), '0.30');
  assert.equal(formatMoney(money('2500.00').minus('3300.005')), '-800.01');
});

test('parseMoneyInput accepts plain 2-decimal amounts and normalizes them', () => {
  assert.equal(parseMoneyInput('100'), '100.00');
  assert.equal(parseMoneyInput('1,250.5'), '1250.50');
  assert.equal(parseMoneyInput(12.34), '12.34');
  assert.equal(parseMoneyInput('0'), '0.00');
});

test('parseMoneyInput rejects invalid amounts', () => {
  for (const bad of ['1.234', '-5', 'abc', '', '1e3', '12.3.4', null, undefined, Number.NaN, 1e-7, '99999999999999.99']) {
    assert.throws(() => parseMoneyInput(bad as unknown as string), Error, `should reject ${String(bad)}`);
  }
});

test('formatMoney always returns exactly two decimals', () => {
  assert.equal(formatMoney(money(5)), '5.00');
  assert.equal(formatMoney('0'), '0.00');
  assert.equal(formatMoney(money('-0.5')), '-0.50');
});

test('ISO date validation rejects impossible dates', () => {
  assert.equal(isValidIsoDate('2026-10-15'), true);
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('15/10/2026'), false);
  assert.equal(isValidIsoDate('2026-10-15T10:00:00Z'), false);
});

test('todayInTimeZone uses the business time zone, not the machine time zone', () => {
  // 2026-10-14 20:30 UTC is already 15 Oct in Asia/Kolkata (+05:30) but still 14 Oct in New York (EDT, -04:00).
  const instant = new Date('2026-10-14T20:30:00Z');
  assert.equal(todayInTimeZone('Asia/Kolkata', instant), '2026-10-15');
  assert.equal(todayInTimeZone('America/New_York', instant), '2026-10-14');
});

test('DATE round-trip keeps the calendar day', () => {
  assert.equal(dbDateToIso(isoDateToDbDate('2026-03-08')), '2026-03-08');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('stableStringify is key-order independent (used for idempotency request hashes)', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(stableStringify({ amount: '1.00' }), stableStringify({ amount: '1.01' }));
});
