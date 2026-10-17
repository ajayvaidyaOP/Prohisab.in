import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MultiReportPage from '../src/pages/MultiReportPage';
import type { CombinedReport, CombinedReportTotals } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ options: vi.fn(), books: vi.fn(), report: vi.fn(), pdf: vi.fn() }));
vi.mock('../src/lib/queries', () => ({
  useSettings: () => ({ data: { today: '2026-10-18', business: { timezone: 'Asia/Kolkata', currencySymbol: '₹' } } }),
}));
vi.mock('../src/lib/api', () => ({ api: {
  accounts: { options: mocks.options }, books: { list: mocks.books },
  transactions: { multiReport: mocks.report, downloadMultiReportPdf: mocks.pdf },
} }));
const totals: CombinedReportTotals = { deposits: '100.10', withdrawals: '25.00', net: '75.10',
  totalEntries: 23, approvedEntries: 21, pendingEntries: 1, rejectedEntries: 1, pendingAmount: '50.00' };
function data(): CombinedReport {
  return {
    summary: totals,
    staffSummary: [{ ...totals, userId: 2, name: 'Ajay', isActive: true }],
    bookSummary: [{ ...totals, bookId: 10, name: 'Online Book' }],
    rows: Array.from({ length: 23 }, (_, index) => ({
      id: index + 1, entryDate: '2026-10-18', createdAt: '2026-10-18T10:00:00Z',
      account: { id: 2, name: 'Ajay' }, bookName: 'Online Book', typeLabel: 'Deposit',
      direction: 'INCREASE', amount: '0.10', customerId: `Customer-${index + 1}`,
      approvalStatus: 'APPROVED', bankDetails: 'Test Bank',
    } as CombinedReport['rows'][number])),
  };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><MultiReportPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  mocks.options.mockResolvedValue({ items: [{ id: 2, name: 'Ajay', isActive: true }, { id: 3, name: 'Night Staff', isActive: false }] });
  mocks.books.mockResolvedValue([{ id: 10, name: 'Online Book', status: 'ACTIVE' }, { id: 11, name: 'Old Book', status: 'ARCHIVED' }]);
  mocks.report.mockResolvedValue(data());
  mocks.pdf.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('enables date selection and distinguishes combined reports from individual ledgers', async () => {
  renderPage();
  expect((screen.getByLabelText('From date') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('To date') as HTMLInputElement).disabled).toBe(false);
  await waitFor(() => expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-10-18'));
  expect(screen.getByText(/full account and running balance/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Individual user ledgers' }).getAttribute('href')).toBe('/accounts');
  expect(mocks.report).not.toHaveBeenCalled();
});

it('only runs on Show Report and keeps totals and PDF tied to applied filters', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  await screen.findByText('Combined entry history');
  expect(mocks.report).toHaveBeenLastCalledWith(null, '2026-10-18', '2026-10-18', undefined);
  const calls = mocks.report.mock.calls.length;
  await user.clear(screen.getByLabelText('From date'));
  await user.type(screen.getByLabelText('From date'), '2026-10-01');
  await user.selectOptions(screen.getByLabelText('Book'), '11');
  expect(mocks.report.mock.calls.length).toBe(calls);
  expect(screen.getByText(/Filters changed/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Download Combined PDF' }));
  expect(mocks.pdf).toHaveBeenLastCalledWith(null, '2026-10-18', '2026-10-18', undefined);
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  await waitFor(() => expect(mocks.report).toHaveBeenLastCalledWith(null, '2026-10-01', '2026-10-18', 11));
});

it('validates reversed dates and empty staff selection instead of silently reporting all staff', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.clear(screen.getByLabelText('From date'));
  await user.type(screen.getByLabelText('From date'), '2026-10-19');
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  expect(screen.getByRole('alert').textContent).toContain('From date must');
  expect(mocks.report).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Today' }));
  await user.click(screen.getByLabelText('Choose staff'));
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  expect(screen.getByRole('alert').textContent).toContain('Select at least one');
  await user.click(await screen.findByLabelText(/Ajay/));
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  await screen.findByText('Combined entry history');
  expect(mocks.report).toHaveBeenLastCalledWith([2], '2026-10-18', '2026-10-18', undefined);
  await user.click(screen.getByRole('button', { name: 'Clear selection' }));
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  expect(screen.getByRole('alert').textContent).toContain('Select at least one');
});

it('shows whole-report summaries, paginates history and offers a link to the full ledger', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('button', { name: 'All dates' }));
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  await screen.findByText('Staff-wise comparison');
  expect(mocks.report).toHaveBeenLastCalledWith(null, undefined, undefined, undefined);
  const summary = screen.getByRole('region', { name: 'Combined totals' });
  expect(summary.textContent).toContain('₹ 100.10');
  expect(summary.textContent).toContain('23');
  expect(screen.getByRole('link', { name: 'Full ledger →' }).getAttribute('href')).toBe('/accounts/2');
  expect(screen.queryByText('Customer-23')).toBeNull();
  await user.click(screen.getByRole('button', { name: /Next/ }));
  expect(screen.getByText('Customer-23')).toBeTruthy();
  expect(within(summary).getByText('₹ 100.10')).toBeTruthy();
  expect(mocks.report).toHaveBeenCalledOnce();
});

it('handles no activity and PDF failures without losing the current report', async () => {
  const user = userEvent.setup();
  const empty = { deposits: '0.00', withdrawals: '0.00', net: '0.00', totalEntries: 0,
    approvedEntries: 0, pendingEntries: 0, rejectedEntries: 0, pendingAmount: '0.00' };
  mocks.report.mockResolvedValue({ rows: [], summary: empty,
    staffSummary: [{ ...empty, userId: 3, name: 'Night Staff', isActive: false }], bookSummary: [] });
  mocks.pdf.mockRejectedValue(new Error('Narrow the date range.'));
  renderPage();
  await user.click(screen.getByRole('button', { name: 'Show Report' }));
  await screen.findByText('No entries for this selection');
  expect(screen.getByText('Inactive')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Download Combined PDF' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Narrow the date range.');
  expect(screen.getByText('No entries for this selection')).toBeTruthy();
});
