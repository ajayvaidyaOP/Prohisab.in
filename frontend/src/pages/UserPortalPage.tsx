import { EntryTable } from '../components/EntryTable';
import { DeleteEntryDialog } from '../components/DeleteEntryDialog';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Loader2,
  Plus,
  ReceiptText,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { useMe } from '../lib/auth';
import {
  cleanAmountInput,
  formatAmount,
  isPositiveAmount,
  toDisplayDate,
} from '../lib/format';
import { invalidateFinancial, useIdempotentKey, useSettings } from '../lib/queries';
import type { LedgerEntry } from '../lib/types';
import {
  Alert,
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  PageHeader,
  SkeletonRows,
} from '../components/ui';

const MAX_HISTORY_ENTRIES = 500;
const HISTORY_PAGE_SIZE = 100;

/** Portal form controls use the blue-accented style of the staff portal. */
const portalInput =
  'block w-full rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-500';

type StatTone = 'emerald' | 'rose' | 'indigo' | 'violet';

function PortalStatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: StatTone }) {
  const chip = {
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    violet: 'bg-violet-50 text-violet-600',
  }[tone];
  const valueTone = {
    emerald: 'text-emerald-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
    violet: 'text-violet-700',
  }[tone];
  return (
    <Card className="flex items-center gap-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${chip}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-0.5 truncate font-mono text-xl font-bold tabular-nums ${valueTone}`}>{value}</p>
      </div>
    </Card>
  );
}

export default function UserPortalPage() {
  const me = useMe();
  const settings = useSettings();
  const queryClient = useQueryClient();

  const accountId = me.data?.accountId;
  const staffId = me.data?.id ?? '—';
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const today = settings.data?.today ?? new Date().toISOString().slice(0, 10);
  const entryOptions =
    settings.data?.business.userEntryOptions && settings.data.business.userEntryOptions.length > 0
      ? settings.data.business.userEntryOptions
      : [
          'Cash Deposit',
          'UPI / Bank Deposit',
          'Cash Withdrawal',
          'UPI / Bank Withdrawal',
          'Site Material',
          'Petrol / Transport',
          'Hardware Bill',
          'Office Expense',
        ];

  // New Entry form state
  const [entryKind, setEntryKind] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [book, setBook] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  // History dates are read-only reporting filters, independent of posting permissions.
  const [fromInput, setFromInput] = useState(today);
  const [toInput, setToInput] = useState(today);
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string }>({ from: today, to: today });
  const [filterError, setFilterError] = useState<string | null>(null);
  const [historyDatesInitialized, setHistoryDatesInitialized] = useState(false);
  useEffect(() => {
    if (historyDatesInitialized || !settings.data?.today) return;
    setFromInput(settings.data.today);
    setToInput(settings.data.today);
    setAppliedRange({ from: settings.data.today, to: settings.data.today });
    setHistoryDatesInitialized(true);
  }, [settings.data?.today, historyDatesInitialized]);

  // Edit entry dialog state
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [editBook, setEditBook] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editKind, setEditKind] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [editCustomerId, setEditCustomerId] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editBankDetails, setEditBankDetails] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const booksQuery = useQuery({ queryKey: ['books'], queryFn: () => api.books.list() });
  const availableBooks = (booksQuery.data ?? []).filter((candidate) => candidate.status === 'ACTIVE');
  // Derive this from the latest assignments: one book needs no manual selection,
  // and a removed/archived assignment must never remain selected.
  const selectedBook = availableBooks.length === 1 ? String(availableBooks[0].id)
    : availableBooks.some((candidate) => String(candidate.id) === book) ? book : '';
  const accountQuery = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => api.accounts.get(accountId!),
    enabled: Boolean(accountId),
  });

  const selectedEntryDate = entryDate === today || entryDate === accountQuery.data?.account.backDateAllowedDate
    ? entryDate : today;

  // The portal shows the most recent entries (up to 500) for the selected dates.
  const ledgerQuery = useQuery({
    queryKey: ['ledger', accountId, { pageSize: HISTORY_PAGE_SIZE, from: appliedRange.from, to: appliedRange.to }],
    queryFn: async () => {
      const params = { pageSize: HISTORY_PAGE_SIZE, from: appliedRange.from || undefined, to: appliedRange.to || undefined };
      const first = await api.ledger.page(accountId!, { ...params, page: 1 });
      const total = first.pagination.total;
      const lastPage = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
      const startPage = Math.max(1, Math.floor((total - MAX_HISTORY_ENTRIES) / HISTORY_PAGE_SIZE) + 1);
      const pages = await Promise.all(
        Array.from({ length: lastPage - startPage + 1 }, (_, index) =>
          startPage + index === 1 ? Promise.resolve(first) : api.ledger.page(accountId!, { ...params, page: startPage + index })),
      );
      return { ...first, entries: pages.flatMap((page) => page.entries).slice(-MAX_HISTORY_ENTRIES) };
    },
    enabled: Boolean(accountId) && historyDatesInitialized,
  });

  const addMoneyMutation = useMutation({
    mutationFn: () => {
      // The portal posts with an implicit option: pick the active option that
      // matches the transaction type, falling back to the first configured option.
      const keyword = entryKind === 'DEPOSIT' ? 'deposit' : 'withdrawal';
      const optionName =
        entryOptions.find((option) => option.toLowerCase().includes(keyword)) ?? entryOptions[0] ?? '';
      return api.transactions.create(
        {
          accountId: accountId!,
          bookId: selectedBook ? Number(selectedBook) : null,
          type: entryKind,
          entryDate: selectedEntryDate,
          amount,
          optionName,
          customerId: customerId.trim() || null,
          bankDetails: bankDetails.trim() || null,
        },
        idempotencyKey,
      );
    },
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId!);
      const kindLabel = entryKind === 'DEPOSIT' ? 'Deposit (+)' : 'Withdrawal (-)';
      setSuccessMessage(
        `${kindLabel} of ${formatAmount(res.transaction.amount, symbol)} submitted! Balance updated.`,
      );
      setAmount('');
      setCustomerId('');
      setBankDetails('');
      setFormError(null);
      setIdempotencyKey(newIdempotencyKey());
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Could not submit entry.');
    },
  });

  const editKey = useIdempotentKey();
  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.transactions.update(editing!.id, body, editKey.keyFor({ id: editing!.id, ...body })),
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId!);
      setSuccessMessage(`Entry #${res.transaction.id} updated.`);
      editKey.reset();
      setEditing(null);
    },
    onError: (err) => {
      setEditError(err instanceof ApiError ? err.message : 'Could not update the entry.');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    const cleanAmount = cleanAmountInput(amount);
    if (!cleanAmount || !isPositiveAmount(cleanAmount)) {
      setFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (availableBooks.length === 0) {
      setFormError('No active books are assigned to your account. Ask the administrator to grant book access.');
      return;
    }
    if (!selectedBook) {
      setFormError('Please select an assigned book.');
      return;
    }
    if (!entryOptions.length) {
      setFormError('Please ask the administrator to configure entry options.');
      return;
    }
    addMoneyMutation.mutate();
  };

  const applyFilter = (event: FormEvent) => {
    event.preventDefault();
    if (fromInput && toInput && fromInput > toInput) {
      setFilterError('From date must be on or before To date.');
      return;
    }
    setFilterError(null);
    setHistoryDatesInitialized(true);
    if (fromInput === appliedRange.from && toInput === appliedRange.to) void ledgerQuery.refetch();
    else setAppliedRange({ from: fromInput, to: toInput });
  };
  const historyDatesChanged = fromInput !== appliedRange.from || toInput !== appliedRange.to;

  const openEdit = (entry: LedgerEntry) => {
    setEditing(entry);
    setEditBook(entry.bookId ? String(entry.bookId) : '');
    setEditDate(entry.entryDate);
    setEditKind(entry.direction === 'DECREASE' ? 'WITHDRAWAL' : 'DEPOSIT');
    setEditCustomerId(entry.customerId ?? '');
    setEditAmount(entry.amount);
    setEditBankDetails(entry.bankDetails ?? '');
    setEditError(null);
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    const cleanAmount = cleanAmountInput(editAmount);
    if (!cleanAmount || !isPositiveAmount(cleanAmount)) {
      setEditError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!editBook) {
      setEditError('Please select an assigned book.');
      return;
    }
    editMutation.mutate({
      accountId,
      type: editKind,
      entryDate: editDate,
      amount: cleanAmount,
      optionName: editing.option ?? null,
      detail: editing.detail ?? null,
      paymentMethod: editing.paymentMethod ?? null,
      bookId: Number(editBook),
      customerId: editCustomerId.trim() || null,
      bankDetails: editBankDetails.trim() || null,
    });
  };

  if (!accountId) {
    return (
      <ErrorState message="Your login is not linked to a user account. Please ask the Administrator to recreate your user login." />
    );
  }

  if (accountQuery.isPending) {
    return (
      <Card padded={false}>
        <SkeletonRows rows={5} cols={4} />
      </Card>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <ErrorState
        message={accountQuery.error instanceof Error ? accountQuery.error.message : 'Could not load your account.'}
        onRetry={() => void accountQuery.refetch()}
      />
    );
  }

  const { account } = accountQuery.data;
  const { entries = [], totals, pagination } = ledgerQuery.data ?? {};
  const backDate = account.backDateAllowedDate;
  // Newest entries first, matching the "recent entries" history list.
  const history = [...entries].reverse();
  const editingBookOptions = editing
    ? editing.bookId && !availableBooks.some((candidate) => candidate.id === editing.bookId)
      ? [{ id: editing.bookId, name: editing.bookName ?? `Book #${editing.bookId}`, status: 'ARCHIVED' }, ...availableBooks]
      : availableBooks
    : availableBooks;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${account.name}`}
        description={`Staff ID: ${staffId} · Only your assigned books and entries are available.`}
      />

      {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      {/* Account summary */}
      <p className="text-xs font-medium text-slate-500">All-time business · Deposits and withdrawals</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortalStatCard label="Total Deposit" value={formatAmount(account.totalUserPaid, symbol)} icon={ArrowDownLeft} tone="emerald" />
        <PortalStatCard label="Total Withdrawal" value={formatAmount(account.totalAdminPaid, symbol)} icon={ArrowUpRight} tone="rose" />
        <PortalStatCard label="Net (Deposit - Withdrawal)" value={formatAmount(account.pendingBalance, symbol)} icon={Scale} tone="indigo" />
        <PortalStatCard label="Total Entries" value={account.entryCount.toLocaleString('en-IN')} icon={ReceiptText} tone="violet" />
      </div>

      {/* New Entry */}
      <Card>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600/10 text-blue-600">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </span>
          New Entry
        </h2>

        {booksQuery.isError && <div className="mt-3"><ErrorState message="Could not load your assigned books." onRetry={() => void booksQuery.refetch()} /></div>}
        {!booksQuery.isPending && !booksQuery.isError && availableBooks.length === 0 && (
          <div className="mt-3">
            <Alert tone="warning">No active books are assigned to your account. Ask the administrator to grant book access before submitting an entry.</Alert>
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-4">
          <Field label="Book" required hint={availableBooks.length === 1 ? "Your only assigned book is selected automatically." : undefined}>
            {(fid) => (
              <select
                id={fid}
                value={selectedBook}
                onChange={(e) => { setBook(e.target.value); setIdempotencyKey(newIdempotencyKey()); }}
                disabled={booksQuery.isPending || booksQuery.isError || availableBooks.length <= 1}
                className={portalInput}
              >
                {availableBooks.length !== 1 && <option value="">Select assigned book</option>}
                {availableBooks.map((availableBook) => (
                  <option key={availableBook.id} value={String(availableBook.id)}>{availableBook.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Entry date"
            required
            hint={backDate
              ? `Back-date permission is active for ${toDisplayDate(backDate)}.`
              : `Past dates need admin permission. Today is ${toDisplayDate(today)}.`}
          >
            {(fid) => (
              <select
                id={fid}
                value={selectedEntryDate}
                onChange={(e) => { setEntryDate(e.target.value); setIdempotencyKey(newIdempotencyKey()); }}
                className={portalInput}
              >
                <option value={today}>Today ({toDisplayDate(today)})</option>
                {backDate && backDate < today ? (
                  <option value={backDate}>Back date ({toDisplayDate(backDate)})</option>
                ) : null}
              </select>
            )}
          </Field>

          <Field label="Transaction type" required>
            {(fid) => (
              <select
                id={fid}
                value={entryKind}
                onChange={(e) => {
                  setEntryKind(e.target.value as 'DEPOSIT' | 'WITHDRAWAL');
                  setIdempotencyKey(newIdempotencyKey());
                }}
                className={portalInput}
              >
                <option value="DEPOSIT">Deposit</option>
                <option value="WITHDRAWAL">Withdrawal</option>
              </select>
            )}
          </Field>

          <Field label="Customer / User ID">
            {(fid) => (
              <input
                id={fid}
                type="text"
                placeholder="e.g. 1721"
                value={customerId}
                maxLength={60}
                onChange={(e) => { setCustomerId(e.target.value); setIdempotencyKey(newIdempotencyKey()); }}
                className={portalInput}
              />
            )}
          </Field>

          <Field label={`Amount (${symbol === '₹' ? 'INR' : symbol})`} required>
            {(fid) => (
              <input
                id={fid}
                type="text"
                inputMode="decimal"
                placeholder="e.g. 1500"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setIdempotencyKey(newIdempotencyKey()); }}
                className={portalInput}
              />
            )}
          </Field>

          <Field label="Bank account details">
            {(fid) => (
              <input
                id={fid}
                type="text"
                placeholder="e.g. UPI / Bank details"
                value={bankDetails}
                maxLength={120}
                onChange={(e) => { setBankDetails(e.target.value); setIdempotencyKey(newIdempotencyKey()); }}
                className={portalInput}
              />
            )}
          </Field>

          <div>
            <button
              type="submit"
              disabled={addMoneyMutation.isPending || booksQuery.isPending || booksQuery.isError || !availableBooks.length}
              aria-busy={addMoneyMutation.isPending || undefined}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addMoneyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Submit Entry
            </button>
          </div>
        </form>
      </Card>

      {/* My History */}
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600/10 text-blue-600">
              <History className="h-4 w-4" aria-hidden="true" />
            </span>
            My History
          </h2>
        </div>

        <div className="space-y-4 border-b border-slate-200 px-5 py-4">
          <form onSubmit={applyFilter} className="flex flex-wrap items-end gap-3">
            <Field label="From">
              {(fid) => (
                <input
                  id={fid}
                  type="date"
                  value={fromInput}
                  onChange={(e) => { setFromInput(e.target.value); setHistoryDatesInitialized(true); setFilterError(null); }}
                  className={`${portalInput} w-40`}
                />
              )}
            </Field>
            <Field label="To">
              {(fid) => (
                <input
                  id={fid}
                  type="date"
                  value={toInput}
                  onChange={(e) => { setToInput(e.target.value); setHistoryDatesInitialized(true); setFilterError(null); }}
                  className={`${portalInput} w-40`}
                />
              )}
            </Field>
            <Button type="submit" loading={ledgerQuery.isFetching}>Filter</Button>
            <Button variant="ghost" onClick={() => { setFromInput(today); setToInput(today); setHistoryDatesInitialized(true); setFilterError(null); }}>Today</Button>
            <Button variant="ghost" onClick={() => { setFromInput(''); setToInput(''); setHistoryDatesInitialized(true); setFilterError(null); }}>All dates</Button>
          </form>
          <p className="text-xs text-slate-500">View your own business for any date or date range. Use the same From and To date for one day. This does not grant back-date entry permission.</p>
          {historyDatesChanged && <p className="text-xs font-medium text-amber-700">Dates changed. Click Filter to update your history and totals.</p>}
          {filterError ? <Alert tone="error">{filterError}</Alert> : null}
          <p className="text-sm text-slate-700">
            <span className="font-medium">Selected dates</span>
            <span className="ml-2 font-semibold text-slate-900">
              {appliedRange.from ? toDisplayDate(appliedRange.from) : 'Beginning'} to {appliedRange.to ? toDisplayDate(appliedRange.to) : 'Latest'}
            </span>
          </p>
        </div>

        {ledgerQuery.isPending || ledgerQuery.isFetching ? <SkeletonRows rows={4} cols={4} />
          : ledgerQuery.isError ? <div className="p-5"><ErrorState message={ledgerQuery.error.message} onRetry={() => void ledgerQuery.refetch()} /></div>
          : totals && pagination && <>
        <p className="px-5 pt-4 text-xs text-slate-500">Selected-period business · Deposits and withdrawals count immediately. Historical rejected entries are excluded from amounts. Totals cover the full date range, even when only the latest 500 entries are shown.</p>
        <div className="grid grid-cols-1 gap-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <PortalStatCard label="Total Deposit" value={formatAmount(totals.increases, symbol)} icon={ArrowDownLeft} tone="emerald" />
          <PortalStatCard label="Total Withdrawal" value={formatAmount(totals.decreases, symbol)} icon={ArrowUpRight} tone="rose" />
          <PortalStatCard label="Net (Deposit - Withdrawal)" value={formatAmount(totals.net, symbol)} icon={Scale} tone="indigo" />
          <PortalStatCard label="Total Entries" value={pagination.total.toLocaleString('en-IN')} icon={ReceiptText} tone="violet" />
        </div>

        {history.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm font-medium text-slate-500">No entries found.</p>
        ) : (
          <EntryTable entries={history} symbol={symbol} onEdit={openEdit} onDelete={setDeleting} />
        )}

        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          Up to {MAX_HISTORY_ENTRIES} recent matching entries shown ({pagination.total} total in selected dates).
          Entries can be edited or deleted for 1 hour after creation.
        </div>
        </>}
      </Card>

      {deleting && <DeleteEntryDialog key={deleting.id} entry={deleting} accountId={accountId ?? undefined} symbol={symbol} onClose={() => setDeleting(null)} />}

      {/* Edit entry dialog (within 1 hour of creation) */}
      <Dialog open={editing !== null} title="Edit Entry" onClose={() => { if (!editMutation.isPending) setEditing(null); }}>
        {editing ? (
          <form onSubmit={submitEdit} className="space-y-4">
            {editError ? <Alert tone="error">{editError}</Alert> : null}
            <Field label="Book" required>
              {(fid) => (
                <select id={fid} value={editBook} onChange={(e) => setEditBook(e.target.value)} className={portalInput}>
                  <option value="">Select assigned book</option>
                  {editingBookOptions.map((option) => (
                    <option key={option.id} value={String(option.id)}>{option.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Entry date" required>
              {(fid) => (
                <select id={fid} value={editDate} onChange={(e) => setEditDate(e.target.value)} className={portalInput}>
                  {[today, backDate ?? '', editing.entryDate]
                    .filter((value, index, all) => value && all.indexOf(value) === index)
                    .sort()
                    .map((value) => (
                      <option key={value} value={value}>
                        {value === today ? `Today (${toDisplayDate(value)})` : toDisplayDate(value)}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Transaction type" required>
              {(fid) => (
                <select
                  id={fid}
                  value={editKind}
                  onChange={(e) => setEditKind(e.target.value as 'DEPOSIT' | 'WITHDRAWAL')}
                  className={portalInput}
                >
                  <option value="DEPOSIT">Deposit</option>
                  <option value="WITHDRAWAL">Withdrawal</option>
                </select>
              )}
            </Field>
            <Field label="Customer / User ID">
              {(fid) => (
                <input
                  id={fid}
                  type="text"
                  value={editCustomerId}
                  maxLength={60}
                  onChange={(e) => setEditCustomerId(e.target.value)}
                  className={portalInput}
                />
              )}
            </Field>
            <Field label={`Amount (${symbol === '₹' ? 'INR' : symbol})`} required>
              {(fid) => (
                <input
                  id={fid}
                  type="text"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className={portalInput}
                />
              )}
            </Field>
            <Field label="Bank account details">
              {(fid) => (
                <input
                  id={fid}
                  type="text"
                  value={editBankDetails}
                  maxLength={120}
                  onChange={(e) => setEditBankDetails(e.target.value)}
                  className={portalInput}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={editMutation.isPending} onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={editMutation.isPending}>
                Save Changes
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
