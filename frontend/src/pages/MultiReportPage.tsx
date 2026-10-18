import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { FileDown, Users } from 'lucide-react';
import { api } from '../lib/api';
import type { CombinedReportTotals } from '../lib/types';
import { formatAmount, formatDate, formatDateTime } from '../lib/format';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Field, PageHeader, Pagination, SelectInput, Skeleton, TextInput } from '../components/ui';
import { useSettings } from '../lib/queries';

type Filters = { from: string; to: string; bookId: string; mode: 'ALL' | 'SELECTED'; selected: number[] };
const PAGE_SIZE = 20;

export default function MultiReportPage() {
  const settings = useSettings();
  const accounts = useQuery({ queryKey: ['accountOptions', 'multi-report'], queryFn: () => api.accounts.options({}) });
  const books = useQuery({ queryKey: ['books'], queryFn: api.books.list });
  const [draft, setDraft] = useState<Filters>({ from: '', to: '', bookId: '', mode: 'ALL', selected: [] });
  const [initialized, setInitialized] = useState(false);
  const [applied, setApplied] = useState<Filters | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (initialized || !settings.data?.today) return;
    setDraft((current) => ({ ...current, from: settings.data.today, to: settings.data.today }));
    setInitialized(true);
  }, [initialized, settings.data?.today]);
  const edit = (changes: Partial<Filters>) => {
    setInitialized(true);
    setDraft((current) => ({ ...current, ...changes }));
    setFilterError(null);
  };
  const report = useQuery({
    queryKey: ['multi-report', applied],
    queryFn: () => api.transactions.multiReport(applied!.mode === 'ALL' ? null : applied!.selected,
      applied!.from || undefined, applied!.to || undefined, applied!.bookId ? Number(applied!.bookId) : undefined),
    enabled: applied !== null,
  });
  const showHistory = (event: FormEvent) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setFilterError('From date must be on or before the To date.');
      return;
    }
    if (draft.mode === 'SELECTED' && !draft.selected.length) {
      setFilterError('Select at least one staff member, or choose All staff.');
      return;
    }
    setFilterError(null);
    setPdfError(null);
    setPage(1);
    const next = { ...draft, selected: [...draft.selected].sort((a, b) => a - b) };
    if (JSON.stringify(next) === JSON.stringify(applied)) void report.refetch();
    else setApplied(next);
  };
  const downloadPdf = async () => {
    if (!applied) return;
    setPdfError(null);
    setDownloadingPdf(true);
    try {
      await api.transactions.downloadMultiReportPdf(applied.mode === 'ALL' ? null : applied.selected,
        applied.from || undefined, applied.to || undefined, applied.bookId ? Number(applied.bookId) : undefined);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Could not download the combined report.');
    } finally { setDownloadingPdf(false); }
  };

  const users = accounts.data?.items ?? [];
  const visibleUsers = users.filter((user) => `${user.name} ${user.id}`.toLowerCase().includes(staffSearch.toLowerCase()));
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const timezone = settings.data?.business.timezone ?? 'Asia/Kolkata';
  const dirty = applied !== null && JSON.stringify({ ...draft, selected: [...draft.selected].sort((a, b) => a - b) }) !== JSON.stringify(applied);
  const data = report.data;
  const totalPages = Math.max(1, Math.ceil((data?.rows.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const history = data?.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) ?? [];
  const period = applied?.from && applied.from === applied.to ? formatDate(applied.from)
    : `${applied?.from ? formatDate(applied.from) : 'Beginning'} – ${applied?.to ? formatDate(applied.to) : 'Latest'}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Multi User Collection Report"
        description="Compare collection across staff and books for the same period, and export one combined report."
        actions={<ButtonLink to="/accounts" variant="secondary"><Users className="h-4 w-4" /> Individual user ledgers</ButtonLink>}
      />
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        <strong>Which report should I use?</strong> Users → Ledger shows one staff member’s full account and running balance.
        {' '}This report compares selected staff together. Its net is for the selected period, not an all-time closing balance.
      </div>

      <Card>
        <form onSubmit={showHistory} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="From date">{(id) => <TextInput id={id} type="date" value={draft.from} onChange={(event) => edit({ from: event.target.value })} />}</Field>
            <Field label="To date">{(id) => <TextInput id={id} type="date" value={draft.to} onChange={(event) => edit({ to: event.target.value })} />}</Field>
            <Field label="Book">{(id) => <SelectInput id={id} value={draft.bookId} onChange={(event) => edit({ bookId: event.target.value })}>
              <option value="">All books</option>
              {(books.data ?? []).map((book) => <option key={book.id} value={book.id}>{book.name}{book.status === 'ARCHIVED' ? ' (Archived)' : ''}</option>)}
            </SelectInput>}</Field>
          </div>
          {books.isError && <ErrorState message={books.error.message} onRetry={() => void books.refetch()} />}
          <fieldset className="space-y-3 border-t border-slate-100 pt-4">
            <legend className="px-1 text-sm font-semibold text-slate-900">Staff selection</legend>
            <div className="flex flex-wrap gap-5 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" name="staff-mode" checked={draft.mode === 'ALL'} onChange={() => edit({ mode: 'ALL', selected: [] })} className="accent-indigo-600" /> All staff</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="staff-mode" checked={draft.mode === 'SELECTED'} onChange={() => edit({ mode: 'SELECTED' })} className="accent-indigo-600" /> Choose staff</label>
            </div>
            {draft.mode === 'ALL' ? <p className="text-xs text-slate-500">Includes active and inactive staff, so historical collection is not missed.</p> : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="w-full sm:max-w-sm"><Field label="Search staff">{(id) => <TextInput id={id} type="search" value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder="Name or staff ID" />}</Field></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">{draft.selected.length} selected</span>
                    <Button variant="secondary" disabled={!users.length} onClick={() => edit({ selected: users.map((user) => user.id) })}>Select all</Button>
                    <Button variant="ghost" onClick={() => edit({ selected: [] })}>Clear selection</Button>
                  </div>
                </div>
                {accounts.isPending ? <Skeleton className="h-24" /> : accounts.isError ? <ErrorState message={accounts.error.message} onRetry={() => void accounts.refetch()} /> : (
                  <div className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleUsers.map((user) => <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={draft.selected.includes(user.id)} onChange={() => edit({ selected: draft.selected.includes(user.id) ? draft.selected.filter((id) => id !== user.id) : [...draft.selected, user.id] })} className="h-4 w-4 accent-indigo-600" />
                      <span className="break-words">{user.name} <span className="text-slate-400">(#{user.id})</span>{!user.isActive && <span className="ml-1 text-xs text-slate-400">Inactive</span>}</span>
                    </label>)}
                    {!visibleUsers.length && <p className="p-2 text-sm text-slate-500">No staff match this search.</p>}
                  </div>
                )}
              </>
            )}
          </fieldset>
          {filterError && <Alert tone="error">{filterError}</Alert>}
          {dirty && <p className="text-sm font-medium text-amber-700">Filters changed. Click Show Report to update. The results and PDF below still use the last applied filters.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!settings.data?.today} onClick={() => edit({ from: settings.data!.today, to: settings.data!.today })}>Today</Button>
              <Button variant="ghost" onClick={() => edit({ from: '', to: '' })}>All dates</Button>
            </div>
            <Button type="submit" loading={report.isFetching}>Show Report</Button>
          </div>
        </form>
      </Card>

      {!applied ? <EmptyState title="Build a combined collection report" description="Choose a date range and all staff or specific staff, then click Show Report. For a single account's running balance, use Users → Ledger." />
        : report.isPending ? <Card><Skeleton className="h-48" /></Card>
        : report.isError ? <ErrorState message={report.error.message} onRetry={() => void report.refetch()} />
        : data && (
          <div className="space-y-6" aria-busy={report.isFetching}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">Combined collection · {period}</h2>
                <p className="mt-1 max-w-3xl break-words text-sm text-slate-500">
                  {applied.mode === 'ALL' ? `All staff (${data.staffSummary.length})` : data.staffSummary.map((row) => row.name).join(', ')}
                  {' · '}{applied.bookId ? books.data?.find((book) => String(book.id) === applied.bookId)?.name ?? 'Selected book' : 'All books'}
                </p>
              </div>
              <Button onClick={() => void downloadPdf()} loading={downloadingPdf} disabled={report.isFetching}><FileDown className="h-4 w-4" /> Download Combined PDF</Button>
            </div>
            {pdfError && <Alert tone="error">{pdfError}</Alert>}
            <section aria-label="Combined totals" className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
              {[
                { label: 'Collection (+)', value: formatAmount(data.summary.deposits, symbol), tone: 'border-t-emerald-500 text-emerald-700' },
                { label: 'Withdrawal (-)', value: formatAmount(data.summary.withdrawals, symbol), tone: 'border-t-rose-400 text-rose-600' },
                { label: 'Period net', value: formatAmount(data.summary.net, symbol), tone: 'border-t-blue-500 text-blue-700' },
                { label: 'Total matching entries', value: String(data.summary.totalEntries), tone: 'border-t-violet-500 text-violet-700' },
              ].map((card) => <Card key={card.label} className={`border-t-[3px] ${card.tone}`}><p className="text-xs font-medium text-slate-500">{card.label}</p><p className="mt-1.5 break-words text-lg font-bold tabular-nums sm:mt-3 sm:text-2xl">{card.value}</p></Card>)}
            </section>
            <p className="text-xs text-slate-500">Posted: {data.summary.approvedEntries} · Pending: {data.summary.pendingEntries} ({formatAmount(data.summary.pendingAmount, symbol)}) · Rejected: {data.summary.rejectedEntries}. Pending/rejected amounts are excluded. Reversal entries offset the original in the period they were posted.</p>
            <ComparisonTable title="Staff-wise comparison" rows={data.staffSummary.map((row) => ({ ...row, key: String(row.userId), ledger: row.userId }))} symbol={symbol} />
            <ComparisonTable title="Book-wise collection" rows={data.bookSummary.map((row) => ({ ...row, key: String(row.bookId ?? 'unassigned') }))} symbol={symbol} />
            <Card padded={false} className="overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Combined entry history</h2><p className="mt-1 text-xs text-slate-500">Read-only history · Times in {timezone} · PDF includes both summaries and all matching entries, not only this page.</p></div>
              {!history.length ? <EmptyState title="No entries for this selection" description="Try another date range, book or staff selection. Staff with no activity are shown above with zero totals." /> : (
                <>
                  <div className="overflow-x-auto">
                    <table className="modern-table responsive-table min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>
                        {['Ledger date', 'Submitted', 'Staff', 'Book', 'Customer ID', 'Type', 'Amount', 'Bank / Reference', 'Edit status'].map((label) => <th key={label} scope="col" className={`px-4 py-3 ${label === 'Amount' ? 'text-right' : ''}`}>{label}</th>)}
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">{history.map((row) => <tr key={row.id} className="align-top hover:bg-slate-50">
                        <td data-label="Ledger date" className="whitespace-nowrap px-4 py-3">{formatDate(row.entryDate)}</td>
                        <td data-label="Submitted" className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(row.createdAt, timezone)}</td>
                        <td data-label="Staff" className="px-4 py-3"><Link to={`/accounts/${row.account.id}`} className="font-medium text-indigo-700 hover:underline">{row.account.name}</Link></td>
                        <td data-label="Book" className="min-w-32 break-words px-4 py-3">{row.bookName ?? 'No book assigned'}</td>
                        <td data-label="Customer ID" className="px-4 py-3">{row.customerId || '—'}</td>
                        <td data-label="Type" className="px-4 py-3"><Badge tone={row.direction === 'INCREASE' ? 'emerald' : 'rose'}>{row.direction === 'INCREASE' ? 'Deposit' : 'Withdrawal'}</Badge>{row.isReversal && <p className="mt-1 text-xs text-amber-700">Reversal</p>}{row.isReversed && <p className="mt-1 text-xs text-slate-500">Reversed</p>}</td>
                        <td data-label="Amount" className={`whitespace-nowrap px-4 py-3 text-right font-mono ${row.direction === 'INCREASE' ? 'text-emerald-700' : 'text-rose-600'}`}>{row.direction === 'INCREASE' ? '+' : '−'}{formatAmount(row.amount, symbol)}</td>
                        <td data-label="Bank / Reference" className="min-w-32 max-w-56 break-words px-4 py-3">{row.bankDetails || '—'}{row.referenceNumber && <p className="mt-1 text-xs text-slate-500">Ref: {row.referenceNumber}</p>}</td>
                        <td data-label="Edit status" className="px-4 py-3">{row.editedAt ? 'Edited' : 'Original'}{row.approvalStatus === 'REJECTED' && <p className="text-xs text-rose-600">Rejected (not counted)</p>}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                  <Pagination page={currentPage} totalPages={totalPages} total={data.rows.length} onChange={setPage} />
                </>
              )}
            </Card>
          </div>
        )}
    </div>
  );
}

function ComparisonTable({ title, rows, symbol }: {
  title: string;
  rows: Array<CombinedReportTotals & { key: string; name: string; ledger?: number; isActive?: boolean }>;
  symbol: string;
}) {
  return <Card padded={false} className="overflow-hidden">
    <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">Posted amounts in the selected period. Entries includes all statuses.</p></div>
    {!rows.length ? <p className="p-5 text-sm text-slate-500">No matching activity.</p> : <div className="overflow-x-auto"><table className="modern-table responsive-table min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>
        {['Name', 'Collection (+)', 'Withdrawal (-)', 'Period net', 'Entries', 'Pending', ...(rows.some((row) => row.ledger) ? ['Ledger'] : [])].map((label) => <th key={label} scope="col" className={`px-4 py-3 ${label !== 'Name' && label !== 'Ledger' ? 'text-right' : ''}`}>{label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.key} className="hover:bg-slate-50">
        <th scope="row" data-label="Name" className="px-4 py-3 text-left font-medium">{row.name}{row.isActive === false && <span className="ml-2 text-xs text-slate-400">Inactive</span>}</th>
        <td data-label="Collection (+)" className="whitespace-nowrap px-4 py-3 text-right font-mono text-emerald-700">{formatAmount(row.deposits, symbol)}</td>
        <td data-label="Withdrawal (-)" className="whitespace-nowrap px-4 py-3 text-right font-mono text-rose-600">{formatAmount(row.withdrawals, symbol)}</td>
        <td data-label="Period net" className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold text-blue-700">{formatAmount(row.net, symbol)}</td>
        <td data-label="Entries" className="px-4 py-3 text-right tabular-nums">{row.totalEntries}</td>
        <td data-label="Pending" className="px-4 py-3 text-right tabular-nums">{row.pendingEntries}</td>
        {row.ledger !== undefined && <td data-label="Ledger" className="whitespace-nowrap px-4 py-3"><Link to={`/accounts/${row.ledger}`} className="text-xs font-semibold text-indigo-700 hover:underline">Full ledger →</Link></td>}
      </tr>)}</tbody>
    </table></div>}
  </Card>;
}
