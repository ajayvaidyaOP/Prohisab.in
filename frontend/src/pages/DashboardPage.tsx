import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, FileDown, Scale, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { formatAmount, formatDate } from '../lib/format';
import type { TransactionFilters } from '../lib/types';
import { ManagedEntries } from '../components/ManagedEntries';
import {
  Alert, Button, ButtonLink, Card, EmptyState, ErrorState, Field,
  PageHeader, Pagination, SelectInput, SkeletonRows,
} from '../components/ui';

const PAGE_SIZE = 20;
type Selection = { bookId: string; accountId: string };

/** One today's-only view. History and user management live in their dedicated menu pages. */
export default function DashboardPage() {
  // Use the server's business date, not the browser's UTC/local calendar. Refresh it while this
  // dashboard is open so returning to a tab after midnight does not keep yesterday's entries.
  const settings = useQuery({
    queryKey: ['settings'], queryFn: api.settings.get, staleTime: 0,
    refetchInterval: 60_000, refetchOnWindowFocus: 'always',
  });
  const today = settings.data?.today;
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const timezone = settings.data?.business.timezone ?? 'Asia/Kolkata';
  const [draft, setDraft] = useState<Selection>({ bookId: '', accountId: '' });
  const [applied, setApplied] = useState<Selection>({ bookId: '', accountId: '' });
  const [paging, setPaging] = useState({ date: '', page: 1 });
  const page = paging.date === today ? paging.page : 1;
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const books = useQuery({ queryKey: ['books'], queryFn: api.books.list });
  const users = useQuery({ queryKey: ['accountOptions', 'dashboard'], queryFn: () => api.accounts.options({}) });

  const filters: TransactionFilters = {
    from: today, to: today,
    bookId: applied.bookId ? Number(applied.bookId) : undefined,
    accountId: applied.accountId ? Number(applied.accountId) : undefined,
    includeReversals: true,
  };
  // Totals and rows come from the same filtered response; summaries cover all pages.
  const entries = useQuery({
    queryKey: ['transactions', 'dashboard-today', filters, page],
    queryFn: () => api.transactions.list({ ...filters, page, pageSize: PAGE_SIZE }),
    enabled: Boolean(today), refetchInterval: 60_000,
  });
  const setPage = (next: number) => setPaging({ date: today ?? '', page: next });
  useEffect(() => {
    if (entries.data && page > Math.max(1, entries.data.pagination.totalPages)) {
      setPaging({ date: today ?? '', page: Math.max(1, entries.data.pagination.totalPages) });
    }
  }, [entries.data, page, today]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied({ ...draft });
    setPage(1);
    setPdfError(null);
    if (draft.bookId === applied.bookId && draft.accountId === applied.accountId && page === 1) void entries.refetch();
  };
  const downloadPdf = async () => {
    if (!today) return;
    setPdfError(null);
    setDownloading(true);
    try { await api.transactions.downloadReportPdf(filters); }
    catch (error) { setPdfError(error instanceof Error ? error.message : 'Could not download today’s report.'); }
    finally { setDownloading(false); }
  };

  if (settings.isError && !today) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  if (!today) return <Card><SkeletonRows rows={4} cols={4} /></Card>;

  const changed = draft.bookId !== applied.bookId || draft.accountId !== applied.accountId;
  const bookLabel = applied.bookId ? books.data?.find((book) => String(book.id) === applied.bookId)?.name ?? 'Selected book' : 'All books';
  const staffLabel = applied.accountId ? users.data?.items.find((user) => String(user.id) === applied.accountId)?.name ?? 'Selected staff' : 'All staff';

  return <div className="space-y-6">
    <PageHeader eyebrow="DAILY OVERVIEW" title="Today's Dashboard"
      description={`${formatDate(today)} · ${timezone} · Today's deposits, withdrawals and entries in one place.`}
      actions={<ButtonLink to="/transactions" variant="secondary">View other dates →</ButtonLink>} />

    <Card className="dashboard-filter-card">
      <div className="dashboard-filter-heading">
        <span className="dashboard-filter-icon"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" /></span>
        <div><h2>Refine today’s view</h2><p>Filter by book or staff member to focus the ledger.</p></div>
      </div>
      <form onSubmit={apply} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label="Book">{(id) => <SelectInput id={id} value={draft.bookId} onChange={(event) => setDraft((prev) => ({ ...prev, bookId: event.target.value }))}>
            <option value="">All books</option>
            {(books.data ?? []).map((book) => <option key={book.id} value={book.id}>{book.name}{book.status === 'ARCHIVED' ? ' (Archived)' : ''}</option>)}
          </SelectInput>}</Field>
          <Field label="Staff">{(id) => <SelectInput id={id} value={draft.accountId} onChange={(event) => setDraft((prev) => ({ ...prev, accountId: event.target.value }))}>
            <option value="">All staff</option>
            {(users.data?.items ?? []).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </SelectInput>}</Field>
          <div className="flex gap-2">
            <Button type="submit" loading={entries.isFetching}>Apply</Button>
            {(draft.bookId || draft.accountId || applied.bookId || applied.accountId) && <Button variant="ghost" onClick={() => {
              setDraft({ bookId: '', accountId: '' }); setApplied({ bookId: '', accountId: '' }); setPage(1); setPdfError(null);
            }}>Reset</Button>}
          </div>
        </div>
        <p className="text-xs text-slate-500">Today only · {formatDate(today)}. Use Entries in the menu for previous dates and reports.</p>
        {changed && <p className="text-xs font-medium text-amber-700">Filters changed. Click Apply to update today's totals, entries and PDF.</p>}
        {(books.isError || users.isError) && <Alert tone="error">Could not load book/staff filters. <button type="button" className="underline" onClick={() => { void books.refetch(); void users.refetch(); }}>Retry filters</button></Alert>}
      </form>
    </Card>
    {settings.isError && <Alert tone="error">Could not refresh the business date. <button type="button" className="underline" onClick={() => void settings.refetch()}>Retry</button></Alert>}

    {entries.isError ? <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
      : entries.isPending ? <Card><SkeletonRows rows={4} cols={4} /></Card> : <>
        <section aria-label="Today's totals" className="space-y-3">
          <div className="dashboard-section-heading"><div><h2>Today at a glance</h2><p>A live snapshot of your selected ledger.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Today’s deposits (+)', value: formatAmount(entries.data.summary.deposits, symbol), icon: TrendingUp, tone: 'emerald' },
              { label: 'Today’s withdrawals (-)', value: formatAmount(entries.data.summary.withdrawals, symbol), icon: TrendingDown, tone: 'rose' },
              { label: 'Today’s net', value: formatAmount(entries.data.summary.net, symbol), icon: Scale, tone: 'indigo' },
              { label: 'Today’s entries', value: entries.data.pagination.total.toLocaleString('en-IN'), icon: ClipboardList, tone: 'blue' },
            ].map(({ label, value, icon: Icon, tone }) => <Card key={label} className={`dashboard-stat-card dashboard-stat--${tone}`}>
              <div className="dashboard-stat-head"><p className="dashboard-stat-label">{label}</p><span className="dashboard-stat-icon"><Icon className="h-5 w-5 shrink-0" aria-hidden="true" /></span></div>
              <p className="dashboard-stat-value break-words tabular-nums">{value}</p>
            </Card>)}
          </div>
        </section>
        <Card padded={false} className="dashboard-entries-card overflow-hidden">
          <div className="dashboard-entries-heading flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div><h2>Today's Entries</h2>
              <p className="mt-1 text-xs">{formatDate(today)} · {bookLabel} · {staffLabel}</p></div>
            <Button variant="secondary" onClick={() => void downloadPdf()} loading={downloading} disabled={entries.isFetching}><FileDown className="h-4 w-4" /> Today’s PDF</Button>
          </div>
          {pdfError && <div className="px-5 pt-4"><Alert tone="error">{pdfError}</Alert></div>}
          {entries.data.items.length ? <>
            <div aria-busy={entries.isFetching} className={entries.isFetching ? 'opacity-60' : ''}>
              <ManagedEntries entries={entries.data.items} symbol={symbol} />
            </div>
            <Pagination page={entries.data.pagination.page} totalPages={entries.data.pagination.totalPages} total={entries.data.pagination.total} onChange={setPage} />
          </> : <EmptyState title="No entries today" description="No entries match today's selected book and staff. New entries will appear here when recorded." />}
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Totals cover all matching entries for today's ledger date, not just this page. Net is today's deposits minus withdrawals, not the all-time balance. Historical rejected entries do not count towards amounts.</p>
        </Card>
      </>}
  </div>;
}
