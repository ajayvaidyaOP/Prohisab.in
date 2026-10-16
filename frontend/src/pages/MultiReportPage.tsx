import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Printer } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Transaction } from '../lib/types';
import { formatDate, formatDateTime } from '../lib/format';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, SelectInput, Skeleton, TextInput } from '../components/ui';
import { useSettings } from '../lib/queries';

export default function MultiReportPage() {
  const settings = useSettings();
  const accounts = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => api.accounts.options({}) });
  const books = useQuery({ queryKey: ['books'], queryFn: api.books.list });
  const [selected, setSelected] = useState<number[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bookId, setBookId] = useState('');
  const [run, setRun] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const selectedBookId = bookId ? Number(bookId) : undefined;
  const report = useQuery({
    queryKey: ['multi-report', selected, from, to, selectedBookId],
    queryFn: () => api.transactions.multiReport(selected.length ? selected : null, from || undefined, to || undefined, selectedBookId),
    enabled: run,
  });

  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const selectAll = () => setSelected((accounts.data?.items ?? []).map((account) => account.id));
  const clearSelection = () => setSelected([]);
  const showHistory = () => {
    setFilterError(null);
    if (from && to && from > to) {
      setFilterError('From date must be on or before the To date.');
      return;
    }
    setRun(true);
  };

  const downloadPdf = async () => {
    try {
      setPdfError(null);
      setDownloadingPdf(true);
      await api.transactions.downloadMultiReportPdf(selected.length ? selected : null, from || undefined, to || undefined, selectedBookId);
    } catch (error) {
      setPdfError(error instanceof ApiError ? error.message : 'Could not download the combined history PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const reportRows: Transaction[] = report.data ?? [];
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const timezone = settings.data?.business.timezone ?? 'Asia/Kolkata';
  const users = accounts.data?.items ?? [];
  const selectedNames = selected.length
    ? users.filter((account) => selected.includes(account.id)).map((account) => account.name).join(', ')
    : 'All staff';

  return (
    <div className="space-y-6" id="multi-user-report">
      <PageHeader title="Multi User Report & PDF History" description="Choose staff members, books and a date range to view and export combined entry history." />

      <Card className="print:hidden">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="From date">
            {(id) => <TextInput id={id} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />}
          </Field>
          <Field label="To date">
            {(id) => <TextInput id={id} type="date" value={to} onChange={(event) => setTo(event.target.value)} />}
          </Field>
          <Field label="Book">
            {(id) => (
              <SelectInput id={id} value={bookId} onChange={(event) => setBookId(event.target.value)}>
                <option value="">All books</option>
                {(books.data ?? []).map((book) => <option key={book.id} value={book.id}>{book.name}{book.status === 'ARCHIVED' ? ' (Archived)' : ''}</option>)}
              </SelectInput>
            )}
          </Field>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-sm font-semibold text-slate-900">Select staff</span>
              <p className="text-xs text-slate-500">No selection means all staff. Selected: {selectedNames || 'None'}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={selectAll}>Select all</Button>
              <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={clearSelection}>Clear (all staff)</Button>
            </div>
          </div>
          {accounts.isPending ? <Skeleton className="h-24" /> : accounts.isError ? <ErrorState message={accounts.error.message} onRetry={() => void accounts.refetch()} /> : (
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {users.map((account) => (
                <label key={account.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggle(account.id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                  <span className="truncate">{account.name} <span className="text-slate-400">(#{account.id})</span></span>
                </label>
              ))}
              {users.length === 0 && <p className="p-2 text-sm text-slate-500">No staff accounts found.</p>}
            </div>
          )}
        </div>
        {filterError && <div className="mt-4"><Alert tone="error">{filterError}</Alert></div>}
        <div className="mt-4 flex justify-end">
          <Button onClick={showHistory} loading={report.isFetching}>Show History</Button>
        </div>
      </Card>

      {run && (
        <Card padded={false} className="print:border-0 print:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Combined entry history</h2>
              <p className="mt-1 text-xs text-slate-500">
                Staff: {selectedNames} · Period: {from ? formatDate(from) : 'All time'} – {to ? formatDate(to) : 'Today'}
                {bookId ? ` · Book: ${(books.data ?? []).find((book) => book.id === selectedBookId)?.name ?? `#${bookId}`}` : ''}
              </p>
            </div>
            {reportRows.length > 0 && !report.isFetching && (
              <div className="flex gap-2 print:hidden">
                <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>
                <Button onClick={() => void downloadPdf()} loading={downloadingPdf}><FileDown className="h-4 w-4" /> Download PDF</Button>
              </div>
            )}
          </div>
          {pdfError && <div className="p-4 print:hidden"><Alert tone="error">{pdfError}</Alert></div>}
          {report.isPending || report.isFetching ? <div className="p-6"><Skeleton className="h-40" /></div>
            : report.isError ? <div className="p-6"><ErrorState message={report.error.message} onRetry={() => void report.refetch()} /></div>
            : reportRows.length === 0 ? <div className="p-6"><EmptyState title="No entries found." description="Try a wider date range or include more staff." /></div>
            : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3 text-left">Entry date</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left">Submitted</th>
                      <th className="px-4 py-3 text-left">Staff</th>
                      <th className="px-4 py-3 text-left">Book</th>
                      <th className="px-4 py-3 text-left">Customer ID</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-right">Amount ({symbol})</th>
                      <th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {reportRows.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-4 py-3">{formatDate(row.entryDate)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.createdAt, timezone)}</td>
                        <td className="px-4 py-3">{row.account?.name ?? '—'}</td>
                        <td className="px-4 py-3">{row.bookName ?? '—'}</td>
                        <td className="px-4 py-3">{row.customerId ?? '—'}</td>
                        <td className="px-4 py-3">{row.typeLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{row.direction === 'DECREASE' ? '−' : '+'}{row.amount}</td>
                        <td className="px-4 py-3"><Badge tone={row.approvalStatus === 'APPROVED' ? 'emerald' : row.approvalStatus === 'REJECTED' ? 'rose' : 'amber'}>{row.approvalStatus ?? 'APPROVED'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}
    </div>
  );
}
