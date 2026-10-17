import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntryTable } from '../src/components/EntryTable';
import { ManagedEntries } from '../src/components/ManagedEntries';
import { formatEntryTimestamp } from '../src/lib/format';
import type { Transaction } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ remove: vi.fn(), update: vi.fn(), books: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({
  ...await original<typeof import('../src/lib/api')>(),
  api: { transactions: { delete: mocks.remove, update: mocks.update }, books: { list: mocks.books } },
}));
const entry = (extra: Partial<Transaction> = {}) => ({
  id: 1, createdAt: new Date().toISOString(), entryDate: '2026-10-18', editedAt: null,
  bookId: 10, bookName: 'Luxury Online', account: { id: 17, name: 'Deposite 0008' },
  type: 'DEPOSIT', direction: 'INCREASE', amount: '1000.00', customerId: 'Rolex 2898',
  bankDetails: 'Irshad S', approvalStatus: 'APPROVED', isReversal: false, isReversed: false, ...extra,
} as Transaction);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('matches the reference columns and distinguishes Original/Edited from editable/locked', () => {
  const old = entry({ id: 2, createdAt: '2026-01-01T00:00:00Z', editedAt: '2026-01-01T00:15:00Z' });
  render(<EntryTable entries={[entry(), old]} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
    'Time (IST)', 'Book', 'Staff', 'Customer ID', 'Type', 'Amount', 'Bank account', 'Edit status', 'Action',
  ]);
  expect(screen.getByText('Original')).toBeTruthy();
  expect(screen.getByText('Edited')).toBeTruthy();
  expect(screen.getAllByText('₹1,000.00')).toHaveLength(2);
  expect(screen.queryByText(/Approved|Approval|Editable|Locked/)).toBeNull();
  expect((screen.getAllByRole('button', { name: 'Edit' })[0] as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getAllByRole('button', { name: 'Delete' })[1] as HTMLButtonElement).disabled).toBe(true);
  expect(formatEntryTimestamp('2026-10-17T20:04:15Z')).toBe('2026-10-18 01:34:15');
});

function managed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  mocks.books.mockResolvedValue([{ id: 10, name: 'Luxury Online', status: 'ACTIVE' }]);
  render(<QueryClientProvider client={client}><ManagedEntries entries={[entry()]} symbol="₹" /></QueryClientProvider>);
  return invalidate;
}

it('requires delete confirmation, allows cancel and invalidates financial views after deletion', async () => {
  const user = userEvent.setup();
  mocks.remove.mockResolvedValue({ deletedId: 1 });
  const invalidate = managed();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('cannot be undone');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.remove).toHaveBeenCalledWith(1, expect.any(String));
  for (const key of ['transactions', 'dashboard', 'multi-report', 'account', 'audit']) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  }
});

it('keeps delete errors visible and reuses the same retry key after a network failure', async () => {
  const user = userEvent.setup();
  mocks.remove.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ deletedId: 1 });
  managed();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
  await user.click(screen.getByRole('button', { name: 'Delete entry' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.remove.mock.calls[0][1]).toBe(mocks.remove.mock.calls[1][1]);
});

it('saves edited fields and refreshes financial views', async () => {
  const user = userEvent.setup();
  mocks.update.mockResolvedValue({ transaction: entry({ editedAt: new Date().toISOString() }) });
  const invalidate = managed();
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.clear(dialog.getByLabelText(/Amount/));
  await user.type(dialog.getByLabelText(/Amount/), '2000.50');
  await user.selectOptions(dialog.getByLabelText('Type'), 'WITHDRAWAL');
  await user.click(dialog.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.update).toHaveBeenCalledWith(1, expect.objectContaining({ amount: '2000.50', type: 'WITHDRAWAL', bookId: 10 }), expect.any(String));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ledger', 17] });
});
