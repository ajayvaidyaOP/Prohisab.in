import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserPortalPage from '../src/pages/UserPortalPage';
import type { BookSummary, LedgerEntry } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ books: vi.fn(), account: vi.fn(), ledger: vi.fn(), create: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ useMe: () => ({ data: { id: 17, accountId: 17, name: 'Ajay', role: 'USER' } }) }));
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/queries')>(),
  useSettings: () => ({ data: { today: '2026-10-18', business: { timezone: 'Asia/Kolkata', currencySymbol: '₹', userEntryOptions: ['Cash Deposit', 'Cash Withdrawal'] } } }),
}));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  api: { books: { list: mocks.books }, accounts: { get: mocks.account },
    ledger: { page: mocks.ledger }, transactions: { create: mocks.create } },
}));
const account = { id: 17, name: 'Ajay', totalUserPaid: '500.00', totalAdminPaid: '100.00', pendingBalance: '400.00', entryCount: 9, backDateAllowedDate: null };
const oneBook = [{ id: 10, name: 'Luxury Online', status: 'ACTIVE' }];
const entry = (id: number, date = '2026-10-01') => ({ id, entryDate: date, createdAt: '2020-10-01T10:00:00Z',
  bookId: 10, bookName: 'Luxury Online', staffName: 'Ajay', direction: 'INCREASE', amount: '12.30',
  approvalStatus: 'APPROVED', isReversal: false, isReversed: false, customerId: `Customer-${id}` } as LedgerEntry);
function ledger(entries: LedgerEntry[] = [], total = entries.length) {
  return { account, entries, pagination: { total, page: 1, pageSize: 100, totalPages: Math.ceil(total / 100) },
    totals: { increases: '12.30', decreases: '2.10', net: '10.20', entryCount: total ? total - 1 : 0 } };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UserPortalPage /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  mocks.books.mockResolvedValue(oneBook);
  mocks.account.mockResolvedValue({ account });
  mocks.ledger.mockResolvedValue(ledger());
  mocks.create.mockResolvedValue({ transaction: { amount: '25.00' } });
});
afterEach(cleanup);

it('automatically selects the only assigned active book and submits without a book click', async () => {
  const user = userEvent.setup();
  renderPage();
  const book = await screen.findByLabelText(/^Book/);
  await waitFor(() => expect((book as HTMLSelectElement).value).toBe('10'));
  expect((book as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText('Your only assigned book is selected automatically.')).toBeTruthy();
  await user.type(screen.getByLabelText(/Amount/), '25');
  await user.click(screen.getByRole('button', { name: 'Submit Entry' }));
  await screen.findByText(/submitted!/);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ accountId: 17, bookId: 10, entryDate: '2026-10-18', amount: '25' }), expect.any(String));
  expect((screen.getByLabelText(/^Book/) as HTMLSelectElement).value).toBe('10');
});

it('keeps a multi-book choice, auto-selects on assignment changes, and never submits a removed book', async () => {
  const user = userEvent.setup();
  const twoBooks = [...oneBook, { id: 11, name: 'Mahakal', status: 'ACTIVE' }];
  mocks.books.mockResolvedValue(twoBooks);
  const client = renderPage();
  const book = await screen.findByLabelText(/^Book/);
  await waitFor(() => expect((book as HTMLSelectElement).disabled).toBe(false));
  expect((book as HTMLSelectElement).value).toBe('');
  await user.selectOptions(book, '11');
  await user.type(screen.getByLabelText(/Amount/), '25');
  await user.click(screen.getByRole('button', { name: 'Submit Entry' }));
  await screen.findByText(/submitted!/);
  expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ bookId: 11 }), expect.any(String));
  client.setQueryData<BookSummary[]>(['books'], oneBook);
  await waitFor(() => expect((screen.getByLabelText(/^Book/) as HTMLSelectElement).value).toBe('10'));
  client.setQueryData<BookSummary[]>(['books'], []);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Submit Entry' }) as HTMLButtonElement).disabled).toBe(true));
});

it('filters any past date/range and shows its own business totals without changing entry-date permissions', async () => {
  const user = userEvent.setup();
  mocks.ledger.mockImplementation(async (_id, params) => ledger(params.from === '2026-10-01' ? [entry(1)] : []));
  renderPage();
  await screen.findByText('My History');
  const calls = mocks.ledger.mock.calls.length;
  await user.clear(screen.getByLabelText('From'));
  await user.type(screen.getByLabelText('From'), '2026-10-01');
  await user.clear(screen.getByLabelText('To'));
  await user.type(screen.getByLabelText('To'), '2026-10-01');
  expect(mocks.ledger.mock.calls.length).toBe(calls);
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  await screen.findByText('Customer-1');
  expect(mocks.ledger).toHaveBeenLastCalledWith(17, { from: '2026-10-01', to: '2026-10-01', page: 1, pageSize: 100 });
  expect(screen.getByText('01-10-2026 to 01-10-2026')).toBeTruthy();
  expect(screen.getByText('₹ 12.30')).toBeTruthy();
  expect(screen.getByText('₹ 10.20')).toBeTruthy();
  expect(screen.getByText('₹ 500.00')).toBeTruthy(); // all-time account summary stays independent
  expect(within(screen.getByLabelText(/^Entry date/)).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['2026-10-18']);
});

it('validates date ranges and keeps filters and the entry form available after a history failure', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('My History');
  await user.clear(screen.getByLabelText('From'));
  await user.type(screen.getByLabelText('From'), '2026-10-19');
  const calls = mocks.ledger.mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  expect(screen.getByRole('alert').textContent).toContain('From date must');
  expect(mocks.ledger.mock.calls.length).toBe(calls);
  mocks.ledger.mockRejectedValueOnce(new Error('History temporarily unavailable.'));
  await user.click(screen.getByRole('button', { name: 'All dates' }));
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  await screen.findByText('History temporarily unavailable.');
  expect(screen.getByLabelText('From')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit Entry' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Today' }));
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  await waitFor(() => expect(screen.queryByText('History temporarily unavailable.')).toBeNull());
});

it('loads the latest 500 entries correctly for a partially filled last page, while keeping full totals', async () => {
  mocks.ledger.mockImplementation(async (_id, params) => {
    const all = Array.from({ length: 550 }, (_, index) => entry(index + 1));
    return ledger(all.slice((params.page - 1) * 100, params.page * 100), 550);
  });
  renderPage();
  await screen.findByText('Customer-550');
  expect(screen.getByText('Customer-51')).toBeTruthy();
  expect(screen.queryByText('Customer-50')).toBeNull();
  expect(screen.getAllByText(/^Customer-/)).toHaveLength(500);
  expect(screen.getByText(/550 total in selected dates/)).toBeTruthy();
  expect(mocks.ledger.mock.calls.filter(([, params]) => params.page === 1)).toHaveLength(1);
});

it('submits withdrawals without an approval message', async () => {
  const user = userEvent.setup();
  renderPage();
  const type = await screen.findByLabelText(/Transaction type/);
  await user.selectOptions(type, 'WITHDRAWAL');
  await user.type(screen.getByLabelText(/Amount/), '25');
  await user.click(screen.getByRole('button', { name: 'Submit Entry' }));
  await screen.findByText(/submitted! Balance updated/);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'WITHDRAWAL' }), expect.any(String));
  expect(screen.queryByText(/Pending Admin Approval/)).toBeNull();
});
