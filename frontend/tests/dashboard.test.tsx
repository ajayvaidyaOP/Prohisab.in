import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DashboardPage from '../src/pages/DashboardPage';
import type { Transaction } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), entries: vi.fn(), books: vi.fn(), users: vi.fn(), pdf: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({
  ...await original<typeof import('../src/lib/api')>(),
  api: { settings: { get: mocks.settings }, books: { list: mocks.books }, accounts: { options: mocks.users },
    transactions: { list: mocks.entries, downloadReportPdf: mocks.pdf } },
}));
const settings = { today: '2026-10-18', business: { currencySymbol: '₹', timezone: 'Asia/Kolkata' } };
const row = { id: 1, createdAt: new Date().toISOString(), entryDate: '2026-10-18', direction: 'INCREASE',
  amount: '1000.00', bookId: 10, bookName: 'Luxury Online', account: { id: 2, name: 'Ajay' }, customerId: 'Rolex 2898',
  bankDetails: 'Irshad S', approvalStatus: 'APPROVED', isReversal: false, isReversed: false, editedAt: null } as Transaction;
function response(page = 1, total = 21) {
  return { items: [{ ...row, id: page, customerId: page === 1 ? 'Rolex 2898' : 'Grey 1399' }],
    summary: { deposits: '1200.00', withdrawals: '200.00', net: '1000.00', approvedEntries: total },
    pagination: { page, pageSize: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) } };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  mocks.settings.mockResolvedValue(settings);
  mocks.entries.mockImplementation(({ page }: { page: number }) => Promise.resolve(response(page)));
  mocks.books.mockResolvedValue([{ id: 10, name: 'Luxury Online', status: 'ACTIVE' }]);
  mocks.users.mockResolvedValue({ items: [{ id: 2, name: 'Ajay' }] });
  mocks.pdf.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('waits for the server business date and shows one today-only entry list with full-period totals', async () => {
  let resolveSettings!: (value: typeof settings) => void;
  mocks.settings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
  renderPage();
  expect(mocks.entries).not.toHaveBeenCalled();
  resolveSettings(settings);
  await screen.findByText('Rolex 2898');
  expect(mocks.entries).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-18', to: '2026-10-18', page: 1, pageSize: 20 }));
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.queryByText(/Date-wise & Book-wise Collection|All Users —|All Time|This Month|Last Month/)).toBeNull();
  expect(screen.getByRole('link', { name: 'View other dates →' }).getAttribute('href')).toBe('/transactions');
  const totals = within(screen.getByRole('region', { name: "Today's totals" }));
  expect(totals.getByText('₹ 1,200.00')).toBeTruthy();
  expect(totals.getByText('₹ 200.00')).toBeTruthy();
  expect(totals.getByText('21')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Time (IST)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
});

it('keeps rows, totals, pagination and PDF on the same applied today/book/staff filters', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Rolex 2898');
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await screen.findByText('Grey 1399');
  expect(mocks.entries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, from: settings.today, to: settings.today }));
  await user.selectOptions(screen.getByLabelText('Book'), '10');
  await user.selectOptions(screen.getByLabelText('Staff'), '2');
  expect(screen.getByText(/Filters changed/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Today’s PDF' }));
  expect(mocks.pdf).toHaveBeenLastCalledWith(expect.objectContaining({ from: settings.today, to: settings.today, bookId: undefined, accountId: undefined }));
  await user.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText('Rolex 2898');
  expect(mocks.entries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, bookId: 10, accountId: 2, from: settings.today, to: settings.today }));
  await user.click(screen.getByRole('button', { name: 'Today’s PDF' }));
  expect(mocks.pdf).toHaveBeenLastCalledWith({ from: settings.today, to: settings.today, bookId: 10, accountId: 2, includeReversals: true });
  await user.click(screen.getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(mocks.entries).toHaveBeenLastCalledWith(expect.objectContaining({ from: settings.today, to: settings.today, page: 1, bookId: undefined, accountId: undefined })));
});

it('rolls over to the new business day on page one instead of showing yesterday’s entries', async () => {
  const user = userEvent.setup();
  const client = renderPage();
  await screen.findByText('Rolex 2898');
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await screen.findByText('Grey 1399');
  client.setQueryData(['settings'], { ...settings, today: '2026-10-19' });
  await waitFor(() => expect(mocks.entries).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-19', to: '2026-10-19', page: 1 })));
});

it('shows a single honest empty state without falling back to all-time user balances', async () => {
  mocks.entries.mockResolvedValue({ ...response(1, 0), items: [], summary: { deposits: '0.00', withdrawals: '0.00', net: '0.00', approvedEntries: 0 } });
  renderPage();
  await screen.findByText('No entries today');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('No collection for these filters')).toBeNull();
  expect(within(screen.getByRole('region', { name: "Today's totals" })).getAllByText('₹ 0.00')).toHaveLength(3);
});

it('shows request and PDF errors with retry without losing the current selection', async () => {
  const user = userEvent.setup();
  mocks.entries.mockRejectedValueOnce(new Error('Entries unavailable'));
  renderPage();
  await screen.findByText('Entries unavailable');
  await user.click(screen.getByRole('button', { name: /Try again|Retry/i }));
  await screen.findByText('Rolex 2898');
  mocks.pdf.mockRejectedValueOnce(new Error('PDF unavailable'));
  await user.click(screen.getByRole('button', { name: 'Today’s PDF' }));
  await screen.findByText('PDF unavailable');
  expect(screen.getByText('Rolex 2898')).toBeTruthy();
});

it('returns to the last available page when deletion removes the last row on a page', async () => {
  const user = userEvent.setup();
  const client = renderPage();
  await screen.findByText('Rolex 2898');
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await screen.findByText('Grey 1399');
  mocks.entries.mockImplementation(({ page }: { page: number }) => Promise.resolve({ ...response(page, 20), items: page === 2 ? [] : [row] }));
  await client.invalidateQueries({ queryKey: ['transactions'] });
  await screen.findByText('Rolex 2898');
  expect(mocks.entries).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, from: settings.today, to: settings.today }));
});
