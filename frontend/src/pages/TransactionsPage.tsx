import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { FileDown, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { formatAmount, formatDate } from '../lib/format';
import { useSettings } from '../lib/queries';
import type { TransactionFilters } from '../lib/types';
import { ManagedEntries } from '../components/ManagedEntries';
import { Alert, Button, ButtonLink, Card, EmptyState, ErrorState, Field, PageHeader, Pagination, SelectInput, SkeletonRows, TextInput } from '../components/ui';

const PAGE_SIZE = 20;
const TYPE_FILTERS = [
  { value: '', label: 'All entries' },
  { value: 'DEPOSIT', label: 'Deposit (+)' },
  { value: 'WITHDRAWAL', label: 'Withdrawal (−)' },
  { value: 'REVERSAL', label: 'Reversals only' },
];
const readFilters = (params: URLSearchParams) => ({
  from: params.get('from') ?? '', to: params.get('to') ?? '',
  bookId: params.get('bookId') ?? '', accountId: params.get('accountId') ?? '',
  search: params.get('search') ?? '', type: params.get('type') ?? '',
  reversals: params.get('reversals') ?? '',
});

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const timezone = settings.data?.business.timezone ?? 'Asia/Kolkata';
  const [draft, setDraft] = useState(() => readFilters(params));
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const applied = readFilters(params);
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  // Keep the filter form aligned with browser back/forward and shared URLs.
  useEffect(() => { setDraft(readFilters(params)); setFilterError(null); }, [params]);

  const books = useQuery({ queryKey: ['books'], queryFn: api.books.list });
  const users = useQuery({ queryKey: ['accountOptions', 'entry-filters'], queryFn: () => api.accounts.options({}) });
  const filters: TransactionFilters = {
    search: applied.search || undefined, type: applied.type || undefined,
    from: applied.from || undefined, to: applied.to || undefined,
    bookId: applied.bookId ? Number(applied.bookId) : undefined,
    accountId: applied.accountId ? Number(applied.accountId) : undefined,
    includeReversals: applied.reversals !== 'hide',
  };
  const query = useQuery({
    queryKey: ['transactions', filters, page],
    queryFn: () => api.transactions.list({ ...filters, page, pageSize: PAGE_SIZE }),
  });
  // Deleting the last item on a page should return to an existing page, not strand the list.
  useEffect(() => {
    if (!query.data) return;
    const lastPage = Math.max(1, query.data.pagination.totalPages);
    if (page > lastPage) {
      const next = new URLSearchParams(params);
      next.set('page', String(lastPage));
      setParams(next, { replace: true });
    }
  }, [query.data, page, params, setParams]);
  const setField = (key: keyof typeof draft, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setFilterError('From date must be on or before To date.');
      return;
    }
    setFilterError(null);
    setPdfError(null);
    const next = new URLSearchParams();
    Object.entries(draft).forEach(([key, value]) => { if (value.trim()) next.set(key, value.trim()); });
    setParams(next);
    if (next.toString() === params.toString()) void query.refetch();
  };
  const downloadPdf = async () => {
    setPdfError(null);
    setDownloading(true);
    try { await api.transactions.downloadReportPdf(filters); }
    catch (err) { setPdfError(err instanceof Error ? err.message : 'Could not download report.'); }
    finally { setDownloading(false); }
  };
  const filtersActive = Object.values(applied).some(Boolean);
  const unappliedChanges = JSON.stringify(draft) !== JSON.stringify(applied);
  const period = applied.from && applied.from === applied.to ? formatDate(applied.from)
    : `${applied.from ? formatDate(applied.from) : 'Beginning'} – ${applied.to ? formatDate(applied.to) : 'Latest'}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Entries & Collection"
        description="Choose any date or date range to see entries and collection. Use the same From and To date for one day's report."
        actions={<ButtonLink to="/transactions/new" variant="primary"><Plus className="h-4 w-4" /> Add entry</ButtonLink>}
      />

      <Card>
        <form onSubmit={applyFilters} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
            <Field label="From">{(id) => <TextInput id={id} type="date" value={draft.from} onChange={(e) => setField('from', e.target.value)} />}</Field>
            <Field label="To">{(id) => <TextInput id={id} type="date" value={draft.to} onChange={(e) => setField('to', e.target.value)} />}</Field>
            <Field label="Book">{(id) => (
              <SelectInput id={id} value={draft.bookId} onChange={(e) => setField('bookId', e.target.value)}>
                <option value="">All books</option>
                {(books.data ?? []).map((book) => <option key={book.id} value={book.id}>{book.name}{book.status === 'ARCHIVED' ? ' (Archived)' : ''}</option>)}
              </SelectInput>
            )}</Field>
            <Field label="User / Staff">{(id) => (
              <SelectInput id={id} value={draft.accountId} onChange={(e) => setField('accountId', e.target.value)}>
                <option value="">All users</option>
                {(users.data?.items ?? []).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </SelectInput>
            )}</Field>
            <Button type="submit" loading={query.isFetching}>Apply</Button>
          </div>
          <div className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[2fr_1fr]">
            <Field label="Search">{(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <TextInput id={id} type="search" value={draft.search} onChange={(e) => setField('search', e.target.value)} placeholder="Staff, book, customer ID, bank or reference" className="pl-9" maxLength={100} />
              </div>
            )}</Field>
            <Field label="Type">{(id) => <SelectInput id={id} value={draft.type} onChange={(e) => setField('type', e.target.value)}>
              {TYPE_FILTERS.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </SelectInput>}</Field>

          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="inline-flex items-center gap-2 text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={draft.reversals !== 'hide'} onChange={(e) => setField('reversals', e.target.checked ? '' : 'hide')} /> Include reversal entries
            </label>
            <div className="flex items-center gap-3">
              <Button variant="ghost" disabled={!settings.data?.today} onClick={() => setDraft((prev) => ({ ...prev, from: settings.data!.today, to: settings.data!.today }))}>Today</Button>
              {(filtersActive || unappliedChanges) && <Button variant="ghost" onClick={() => { setDraft(readFilters(new URLSearchParams())); setParams(new URLSearchParams()); setFilterError(null); }}>Clear filters / All dates</Button>}
            </div>
          </div>
          {unappliedChanges && <p className="text-xs font-medium text-amber-700">Filters changed. Click Apply to refresh entries, totals and PDF.</p>}
          {filterError && <Alert tone="error">{filterError}</Alert>}
          {(books.isError || users.isError) && <Alert tone="error">Could not load book/user options. <button type="button" className="underline" onClick={() => { void books.refetch(); void users.refetch(); }}>Retry</button></Alert>}
        </form>
      </Card>

      {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : query.isPending ? (
        <Card><SkeletonRows rows={4} cols={4} /></Card>
      ) : (
        <>
          <section aria-label="Collection summary" className="space-y-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">Showing: {period}</span>
              {' · '}{books.data?.find((book) => String(book.id) === applied.bookId)?.name ?? (applied.bookId ? 'Selected book' : 'All books')}
              {' · '}{users.data?.items.find((user) => String(user.id) === applied.accountId)?.name ?? (applied.accountId ? 'Selected user' : 'All users')}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
              {[
                { label: 'Total Deposit / Collection (+)', value: formatAmount(query.data.summary.deposits, symbol), style: 'border-t-emerald-500 text-emerald-700' },
                { label: 'Total Withdrawal (-)', value: formatAmount(query.data.summary.withdrawals, symbol), style: 'border-t-rose-400 text-rose-600' },
                { label: 'Net (Deposit − Withdrawal)', value: formatAmount(query.data.summary.net, symbol), style: 'border-t-blue-500 text-blue-700' },
                { label: 'Total Entries', value: String(query.data.pagination.total), style: 'border-t-violet-500 text-violet-700' },
              ].map((card) => <Card key={card.label} className={`border-t-[3px] ${card.style}`}>
                <p className="text-xs font-medium text-slate-500">{card.label}</p>
                <p className="mt-1.5 break-words text-lg font-bold tabular-nums sm:mt-3 sm:text-2xl">{card.value}</p>
              </Card>)}
            </div>
            <p className="text-xs text-slate-500">Deposits and withdrawals count immediately, across all pages. Historical rejected entries are excluded from amounts. Reversals follow the selected filter.</p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="primary" loading={downloading} onClick={() => void downloadPdf()}><FileDown className="h-4 w-4" /> Print / Save PDF Report</Button>
            <span className="text-xs text-slate-500">Ledger dates · Entry time ({timezone})</span>
          </div>
          {pdfError && <Alert tone="error">{pdfError}</Alert>}

          <Card padded={false} className="overflow-hidden">
            {query.data.items.length === 0 ? <EmptyState title="No entries for these filters" description="Try a different date range, book or user." /> : (
              <>
                <div className={`overflow-x-auto ${query.isFetching ? 'opacity-60' : ''}`} aria-busy={query.isFetching}>
                  <ManagedEntries entries={query.data.items} symbol={symbol} />
                </div>
                <Pagination page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={(page) => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); }} />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
