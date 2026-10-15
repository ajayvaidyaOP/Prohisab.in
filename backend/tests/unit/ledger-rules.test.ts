import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, formatMoney } from '../../src/lib/money.ts';
import { TRANSACTION_RULES, NORMAL_SIDE_BY_ACCOUNT_TYPE, matchesRule, isUserTransactionType } from '../../src/modules/ledger/ledger.rules.ts';
import { accountBalances, netBalance, runningStatement, describeBalance, balancesFromAggregates, sumDirections } from '../../src/modules/ledger/ledger.balance.ts';

test('posting rules match the specification exactly', () => {
  const expected: Array<[string, string, string, string, string]> = [
    ['CREDIT_SALE', 'CUSTOMER', 'RECEIVABLE', 'INCREASE', 'customer credit sale'],
    ['PAYMENT_RECEIVED', 'CUSTOMER', 'RECEIVABLE', 'DECREASE', 'customer payment'],
    ['CUSTOMER_CREDIT_ADJUSTMENT', 'CUSTOMER', 'RECEIVABLE', 'DECREASE', 'customer refund/credit'],
    ['CREDIT_PURCHASE', 'SUPPLIER', 'PAYABLE', 'INCREASE', 'supplier credit purchase'],
    ['PAYMENT_MADE', 'SUPPLIER', 'PAYABLE', 'DECREASE', 'supplier payment'],
    ['SUPPLIER_CREDIT_ADJUSTMENT', 'SUPPLIER', 'PAYABLE', 'DECREASE', 'supplier return/credit'],
  ];
  for (const [type, accountType, side, direction] of expected) {
    assert.ok(isUserTransactionType(type), type);
    const rule = TRANSACTION_RULES[type as keyof typeof TRANSACTION_RULES];
    assert.equal(rule.accountType, accountType, `${type} account type`);
    assert.equal(rule.side, side, `${type} side`);
    assert.equal(rule.direction, direction, `${type} direction`);
    assert.equal(matchesRule(type as keyof typeof TRANSACTION_RULES, side as 'RECEIVABLE', direction as 'INCREASE'), true);
  }
});

test('mismatched side/direction combinations are rejected by the rule matcher', () => {
  assert.equal(matchesRule('PAYMENT_RECEIVED', 'RECEIVABLE', 'INCREASE'), false);
  assert.equal(matchesRule('CREDIT_SALE', 'PAYABLE', 'INCREASE'), false);
  assert.equal(matchesRule('PAYMENT_MADE', 'RECEIVABLE', 'DECREASE'), false);
  assert.equal(isUserTransactionType('REVERSAL'), false);
  assert.equal(isUserTransactionType('DROP TABLE'), false);
});

test('normal side is tied to the account type', () => {
  assert.equal(NORMAL_SIDE_BY_ACCOUNT_TYPE.CUSTOMER, 'RECEIVABLE');
  assert.equal(NORMAL_SIDE_BY_ACCOUNT_TYPE.SUPPLIER, 'PAYABLE');
});

test('customer workflow balances: opening 1000 + sale 500 - payment 300 = 1200', () => {
  const rows = [
    { id: 1, entryDate: '2026-10-01', side: 'RECEIVABLE' as const, direction: 'INCREASE' as const, amount: money('500.00') },
    { id: 2, entryDate: '2026-10-02', side: 'RECEIVABLE' as const, direction: 'DECREASE' as const, amount: money('300.00') },
  ];
  const balances = accountBalances(money('1000.00'), 'RECEIVABLE', rows);
  assert.equal(formatMoney(balances.receivable), '1200.00');
  assert.equal(formatMoney(balances.payable), '0.00');
});

test('overpayment is shown as a negative (credit) balance, never clamped to zero', () => {
  const amount = netBalance(money('100.00'), 'RECEIVABLE', 'RECEIVABLE', [
    { id: 1, entryDate: '2026-10-01', side: 'RECEIVABLE', direction: 'DECREASE', amount: money('250.00') },
  ]);
  assert.equal(formatMoney(amount), '-150.00');
  assert.deepEqual(describeBalance(amount), { status: 'CREDIT', absolute: '150.00' });
});

test('receivables and payables are never combined', () => {
  const supplierBalances = accountBalances(money('1200.00'), 'PAYABLE', [
    { id: 1, entryDate: '2026-10-01', side: 'PAYABLE', direction: 'INCREASE', amount: money('900.00') },
    { id: 2, entryDate: '2026-10-02', side: 'PAYABLE', direction: 'DECREASE', amount: money('500.00') },
  ]);
  assert.equal(formatMoney(supplierBalances.payable), '1600.00');
  assert.equal(formatMoney(supplierBalances.receivable), '0.00');
});

test('running statement: running balance after each row, closing equals final row', () => {
  const rows = [
    { id: 1, entryDate: '2026-10-01', side: 'PAYABLE' as const, direction: 'INCREASE' as const, amount: money('900.00') },
    { id: 2, entryDate: '2026-10-02', side: 'PAYABLE' as const, direction: 'DECREASE' as const, amount: money('50.00') },
  ];
  const statement = runningStatement(money('1200.00'), 'PAYABLE', 'PAYABLE', rows);
  assert.deepEqual(statement.lines.map((l) => formatMoney(l.runningBalance)), ['2100.00', '2050.00']);
  assert.equal(formatMoney(statement.closing), '2050.00');
  assert.equal(formatMoney(statement.openingOnNormalSide), '1200.00');
});

test('database aggregates produce the same balances as row-by-row math', () => {
  const rows = [
    { id: 1, entryDate: '2026-10-01', side: 'RECEIVABLE' as const, direction: 'INCREASE' as const, amount: money('75.25') },
    { id: 2, entryDate: '2026-10-02', side: 'RECEIVABLE' as const, direction: 'DECREASE' as const, amount: money('10.10') },
    { id: 3, entryDate: '2026-10-03', side: 'RECEIVABLE' as const, direction: 'INCREASE' as const, amount: money('0.01') },
  ];
  const fromRows = accountBalances(money('20.00'), 'RECEIVABLE', rows);
  const fromAgg = balancesFromAggregates(money('20.00'), 'RECEIVABLE', [
    { side: 'RECEIVABLE', direction: 'INCREASE', total: money('75.26') },
    { side: 'RECEIVABLE', direction: 'DECREASE', total: money('10.10') },
  ]);
  assert.equal(formatMoney(fromRows.receivable), formatMoney(fromAgg.receivable));
  assert.equal(formatMoney(fromAgg.receivable), '85.16');
});

test('sumDirections totals increases and decreases separately', () => {
  const totals = sumDirections([
    { direction: 'INCREASE', amount: money('1.10') },
    { direction: 'INCREASE', amount: money('2.20') },
    { direction: 'DECREASE', amount: money('0.30') },
  ]);
  assert.equal(formatMoney(totals.increases), '3.30');
  assert.equal(formatMoney(totals.decreases), '0.30');
});
