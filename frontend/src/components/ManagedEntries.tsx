import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cleanAmountInput, isPositiveAmount } from '../lib/format';
import { invalidateFinancial, useIdempotentKey } from '../lib/queries';
import { EntryTable, type EntryRow } from './EntryTable';
import { DeleteEntryDialog } from './DeleteEntryDialog';
import { Alert, Button, Dialog, Field, SelectInput, TextInput } from './ui';

/** Admin entry actions, shared by the all-entries and per-user ledgers. */
export function ManagedEntries({ entries, symbol, accountId, disabled = false }: {
  entries: EntryRow[]; symbol: string; accountId?: number; disabled?: boolean;
}) {
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [deleting, setDeleting] = useState<EntryRow | null>(null);
  return <>
    <p className="px-4 py-2 text-xs text-slate-500">Edit and Delete are available for 1 hour after creation. Linked reversal entries are protected.</p>
    <EntryTable entries={entries} symbol={symbol} disabled={disabled} onEdit={setEditing} onDelete={setDeleting} />
    {editing && <EditEntryDialog key={editing.id} entry={editing} accountId={accountId} onClose={() => setEditing(null)} />}
    {deleting && <DeleteEntryDialog key={deleting.id} entry={deleting} accountId={accountId} symbol={symbol} onClose={() => setDeleting(null)} />}
  </>;
}

function EditEntryDialog({ entry, accountId, onClose }: { entry: EntryRow; accountId?: number; onClose: () => void }) {
  const [form, setForm] = useState({ bookId: String(entry.bookId ?? ''), entryDate: entry.entryDate,
    type: entry.direction === 'INCREASE' ? 'DEPOSIT' : 'WITHDRAWAL', amount: entry.amount,
    customerId: entry.customerId ?? '', bankDetails: entry.bankDetails ?? '' });
  const [error, setError] = useState<string | null>(null);
  const books = useQuery({ queryKey: ['books'], queryFn: api.books.list });
  const client = useQueryClient();
  const retryKey = useIdempotentKey();
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.transactions.update(entry.id, body, retryKey.keyFor(body)),
    onSuccess: () => {
      invalidateFinancial(client, 'account' in entry ? entry.account.id : accountId);
      void client.invalidateQueries({ queryKey: ['audit'] });
      onClose();
    },
  });
  const field = (name: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [name]: value }));
  const close = () => { if (!mutation.isPending) onClose(); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = cleanAmountInput(form.amount);
    if (!isPositiveAmount(amount)) { setError('Enter an amount greater than zero with up to 2 decimals.'); return; }
    setError(null);
    mutation.mutate({ ...form, amount, bookId: form.bookId ? Number(form.bookId) : null });
  };
  return <Dialog open title={`Edit entry #${entry.id}`} onClose={close}>
    <form onSubmit={submit} className="space-y-4">
      {(error || mutation.isError) && <Alert tone="error">{error || mutation.error?.message}</Alert>}
      {books.isError && <Alert tone="error">Could not load books. <button type="button" className="underline" onClick={() => void books.refetch()}>Retry</button></Alert>}
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <Field label="Book">{(id) => <SelectInput id={id} value={form.bookId} onChange={(e) => field('bookId', e.target.value)}>
          <option value="">No book assigned</option>
          {entry.bookId && !books.data?.some((book) => book.id === entry.bookId) && <option value={entry.bookId}>{entry.bookName}</option>}
          {(books.data ?? []).filter((book) => book.status === 'ACTIVE' || book.id === entry.bookId).map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
        </SelectInput>}</Field>
        <Field label="Entry date" required>{(id) => <TextInput id={id} type="date" required value={form.entryDate} onChange={(e) => field('entryDate', e.target.value)} />}</Field>
        <Field label="Type">{(id) => <SelectInput id={id} value={form.type} onChange={(e) => field('type', e.target.value)}><option value="DEPOSIT">Deposit</option><option value="WITHDRAWAL">Withdrawal</option></SelectInput>}</Field>
        <Field label="Customer ID">{(id) => <TextInput id={id} maxLength={60} value={form.customerId} onChange={(e) => field('customerId', e.target.value)} />}</Field>
        <Field label="Amount" required>{(id) => <TextInput id={id} required inputMode="decimal" value={form.amount} onChange={(e) => field('amount', e.target.value)} />}</Field>
        <Field label="Bank account">{(id) => <TextInput id={id} maxLength={255} value={form.bankDetails} onChange={(e) => field('bankDetails', e.target.value)} />}</Field>
      </fieldset>
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={mutation.isPending} onClick={close}>Cancel</Button><Button type="submit" loading={mutation.isPending}>Save changes</Button></div>
    </form>
  </Dialog>;
}
