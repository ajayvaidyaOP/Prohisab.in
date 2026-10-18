import type { LedgerEntry, Transaction } from '../lib/types';
import { formatEntryTimestamp, formatPlain } from '../lib/format';

export type EntryRow = LedgerEntry | Transaction;
export const entryCanEdit = (entry: EntryRow) =>
  !entry.isReversal && !entry.isReversed && entry.approvalStatus !== 'REJECTED'
  && (Date.parse(entry.createdAt) + 60 * 60_000 > Date.now());
export const entryCanDelete = (entry: EntryRow) =>
  !entry.isReversal && !entry.isReversed
  && (Date.parse(entry.createdAt) + 60 * 60_000 > Date.now());

/** Shared staff/admin entry list. Edit history is independent of the permission window. */
export function EntryTable<T extends EntryRow>({ entries, symbol = '₹', disabled = false, onEdit, onDelete }: {
  entries: T[]; symbol?: string; disabled?: boolean;
  onEdit: (entry: T) => void; onDelete: (entry: T) => void;
}) {
  return <div className="overflow-x-auto">
    <table className="ledger-table responsive-table min-w-full text-left text-base text-[#102c50]">
      <thead className="border-b border-indigo-100 bg-[#f3f6ff] text-sm font-semibold text-[#4d6488]">
        <tr>{['Time (IST)', 'Book', 'Staff', 'Customer ID', 'Type', 'Amount', 'Bank account', 'Edit status', 'Action'].map((label) =>
          <th key={label} scope="col" className="whitespace-nowrap px-4 py-4">{label}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-indigo-100 bg-white">
        {entries.map((entry) => <tr key={entry.id} className="hover:bg-blue-50/40">
          <td data-label="Time (IST)" className="whitespace-nowrap px-4 py-4 tabular-nums" title={`Ledger date: ${entry.entryDate}`}>{formatEntryTimestamp(entry.createdAt)}</td>
          <td data-label="Book" className="whitespace-nowrap px-4 py-4">{entry.bookName || '—'}</td>
          <td data-label="Staff" className="whitespace-nowrap px-4 py-4">{'account' in entry ? entry.account.name : entry.staffName || '—'}</td>
          <td data-label="Customer ID" className="whitespace-nowrap px-4 py-4">{entry.customerId || '—'}</td>
          <td data-label="Type" className="whitespace-nowrap px-4 py-4">
            <span className={`inline-flex rounded-full px-2.5 py-1 ${entry.direction === 'INCREASE' ? 'bg-emerald-100/80 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {entry.isReversal ? 'Reversal' : entry.direction === 'INCREASE' ? 'Deposit' : 'Withdrawal'}
            </span>
            {entry.isReversed && <span className="mt-1 block text-xs text-slate-500">Reversed</span>}
            {entry.approvalStatus === 'REJECTED' && <span className="mt-1 block text-xs text-rose-600">Rejected (not counted)</span>}
          </td>
          <td data-label="Amount" className="whitespace-nowrap px-4 py-4 tabular-nums">{symbol}{formatPlain(entry.amount)}</td>
          <td data-label="Bank account" className="max-w-64 break-words px-4 py-4">{entry.bankDetails || '—'}</td>
          <td data-label="Edit status" className="whitespace-nowrap px-4 py-4" title={entry.editedAt ? `Last edited: ${formatEntryTimestamp(entry.editedAt)} IST` : undefined}>{entry.editedAt ? 'Edited' : 'Original'}</td>
          <td data-label="Action" className="whitespace-nowrap px-4 py-4">
            <div className="flex items-center gap-2">
              <button type="button" disabled={disabled || !entryCanEdit(entry)} onClick={() => onEdit(entry)}
                title={!entryCanEdit(entry) ? 'Editing is locked for this entry' : undefined}
                className="entry-action entry-action-edit rounded-lg bg-blue-600 px-3.5 py-3 font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40">Edit</button>
              <button type="button" disabled={disabled || !entryCanDelete(entry)} onClick={() => onDelete(entry)}
                title={!entryCanDelete(entry) ? 'Deletion is locked for this entry' : undefined}
                className="entry-action entry-action-delete rounded-xl bg-[#d93658] px-3 py-2 font-semibold text-white hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-40">Delete</button>
            </div>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
