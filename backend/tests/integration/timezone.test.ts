import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, RUN, uniqueKey, todayInBusinessZone } from './helpers.ts';

/**
 * DATE columns are calendar days. They must not drift when the machine, the database session or the
 * browser is in a different time zone. Run this file under several TZ values, e.g.
 *   TZ=America/New_York node --import tsx --test tests/integration/timezone.test.ts
 *   TZ=Asia/Kolkata     node --import tsx --test tests/integration/timezone.test.ts
 */
const app = await bootApp();
let api: ReturnType<typeof app.api>;
let accountId = 0;
const boundaryDates = ['2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02', '2024-02-29', '2026-01-01', '2026-12-31'];

before(async () => {
  api = app.api();
  expectOk(await api.login());
  const created = await api.post('/api/accounts', { name: `TZ ${RUN}`, type: 'CUSTOMER', openingBalance: '0' }, uniqueKey('tz'));
  accountId = created.body.account.id;
});
after(async () => {
  await app.close();
});

function expectOk(res: { status: number; body: any }): void {
  assert.ok(res.status < 300, `status ${res.status}: ${JSON.stringify(res.body)}`);
}

describe('DATE values keep their calendar day', () => {
  test('entries on DST boundaries and leap days read back unchanged', async () => {
    for (const date of boundaryDates) {
      // Written directly through Prisma (bypasses the "not in the future" rule so historical dates can be tested).
      await app.prisma.ledgerEntry.create({
        data: { accountId, entryDate: new Date(`${date}T00:00:00Z`), type: 'CREDIT_SALE', side: 'RECEIVABLE', direction: 'INCREASE', amount: '1.00', notes: `tz ${date}` },
      });
    }
    const res = await api.get(`/api/accounts/${accountId}/ledger?pageSize=100`);
    expectOk(res);
    const dates = res.body.entries.map((e: any) => e.entryDate);
    for (const date of boundaryDates) {
      assert.ok(dates.includes(date), `${date} missing; got ${dates.join(', ')}`);
    }
    const sorted = [...dates].sort();
    assert.deepEqual(dates, sorted, 'ledger is ordered by calendar date');
  });

  test('a date filter selects exactly the calendar days requested', async () => {
    const res = await api.get(`/api/accounts/${accountId}/ledger?from=2026-03-08&to=2026-03-09&pageSize=100`);
    expectOk(res);
    assert.deepEqual(res.body.entries.map((e: any) => e.entryDate), ['2026-03-08', '2026-03-09']);
  });

  test('today on the dashboard is the business calendar date (Settings time zone), not the machine date', async () => {
    const res = await api.get('/api/dashboard');
    expectOk(res);
    assert.equal(res.body.today, todayInBusinessZone());
  });

  test('timestamps (DATETIME) are stored as UTC and returned as ISO strings close to now', async () => {
    const before = Date.now();
    const res = await api.post('/api/transactions', { accountId, type: 'CREDIT_SALE', entryDate: todayInBusinessZone(), amount: '2.00' }, uniqueKey('tzts'));
    expectOk(res);
    const created = Date.parse(res.body.transaction.createdAt);
    assert.ok(Number.isFinite(created));
    assert.ok(Math.abs(created - before) < 60_000, 'createdAt is within a minute of the request');
    assert.match(res.body.transaction.createdAt, /Z$/);
  });
});
