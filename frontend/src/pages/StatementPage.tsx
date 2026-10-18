import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams, Link } from 'react-router';
import { Printer, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { formatAmount, formatDate, formatPlain } from '../lib/format';
import { useSettings } from '../lib/queries';
import { Alert, Button, EmptyState, ErrorState, Skeleton } from '../components/ui';

/** Full statement for printing or saving as PDF. Shows every entry in the chosen period (no pagination). */
export default function StatementPage() {
  const { id } = useParams();
  const accountId = Number(id);
  const [params] = useSearchParams();
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;
  const search = params.get('search') || undefined;
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const business = settings.data?.business;

  const query = useQuery({
    queryKey: ['statement', accountId, { from, to, search }],
    queryFn: () => api.ledger.statement(accountId, { from, to, search }),
    enabled: Number.isFinite(accountId),
  });

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6" role="status" aria-label="Preparing statement">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        <p className="mt-4">
          <Link to="/accounts" className="text-indigo-700 underline">
            Back to accounts
          </Link>
        </p>
      </div>
    );
  }

  const d = query.data;
  const a = d.account;
  const periodLabel = from || to ? `${from ? formatDate(from) : 'Beginning'} to ${to ? formatDate(to) : 'latest entry'}` : 'All entries';
  const generated = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: settings.data?.business.timezone ?? 'Asia/Kolkata' }).format(new Date());

  return (
    <div className="mx-auto max-w-4xl bg-white p-4 text-slate-900 sm:p-8 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/accounts/${accountId}${params.toString() ? `?${params.toString()}` : ''}`} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to ledger
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Print / save as PDF
        </Button>
      </div>

      <header className="flex flex-col gap-2 border-b border-slate-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-lg font-semibold">{business?.businessName ?? 'Simple Ledger ERP'}</p>
          {business?.businessAddress && <p className="whitespace-pre-line text-sm text-slate-600">{business.businessAddress}</p>}
          {(business?.businessPhone || business?.businessEmail) && (
            <p className="text-sm text-slate-600">{[business?.businessPhone, business?.businessEmail].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="text-sm sm:text-right">
          <p className="text-base font-semibold">Account statement</p>
          <p className="text-slate-600">Period: {periodLabel}</p>
          <p className="text-slate-600">Generated: {generated}</p>
        </div>
      </header>

      <section className="grid gap-3 py-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-semibold">{a.name}</p>
          <p className="font-mono text-xs text-slate-600">{a.accountCode} · {a.typeLabel}</p>
          {a.phone && <p className="text-slate-600">{a.phone}</p>}
          {a.email && <p className="text-slate-600">{a.email}</p>}
          {a.address && <p className="whitespace-pre-line text-slate-600">{a.address}</p>}
        </div>
        <div className="sm:text-right">
          <p>
            Opening balance ({d.openingBalance.side === 'RECEIVABLE' ? 'receivable' : 'payable'}):{' '}
            <span className="font-semibold tabular-nums">{formatAmount(d.openingBalance.amount, symbol)}</span>
          </p>
          {from && (
            <p>
              Brought forward: <span className="font-semibold tabular-nums">{formatAmount(d.balanceBroughtForward.amount, symbol)}</span>
            </p>
          )}
          <p>
            Closing balance: <span className="font-semibold tabular-nums">{formatAmount(d.closingBalance.amount, symbol)}</span>{' '}
            <span className="text-slate-600">({d.closingBalance.status === 'CREDIT' ? 'credit' : d.closingBalance.status === 'DUE' ? 'due' : 'settled'})</span>
          </p>
        </div>
      </section>

      {d.entries.length === 0 ? (
        <EmptyState title="No entries in this period." />
      ) : (
        <div className="overflow-x-auto">
          <table className="responsive-table min-w-full border-collapse text-sm print:text-[11px]">
            <thead>
              <tr className="border-b-2 border-slate-400 text-left text-xs uppercase tracking-wide text-slate-600">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3 text-right">Increase</th>
                <th className="py-2 pr-3 text-right">Decrease</th>
                <th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {d.entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-200 align-top print-break-inside-avoid">
                  <td data-label="Date" className="whitespace-nowrap py-2 pr-3">{formatDate(e.entryDate)}</td>
                  <td data-label="Description" className="py-2 pr-3">
                    {e.typeLabel}
                    {e.isReversal && e.reversalOfId ? ` (reverses #${e.reversalOfId})` : ''}
                    {e.isReversed ? ' [reversed]' : ''}
                    {e.notes && <span className="block text-xs text-slate-600">{e.notes}</span>}
                  </td>
                  <td data-label="Reference" className="py-2 pr-3 break-words">{e.referenceNumber ?? ''}</td>
                  <td data-label="Increase" className="py-2 pr-3 text-right tabular-nums">{e.direction === 'INCREASE' ? formatPlain(e.amount) : ''}</td>
                  <td data-label="Decrease" className="py-2 pr-3 text-right tabular-nums">{e.direction === 'DECREASE' ? formatPlain(e.amount) : ''}</td>
                  <td data-label="Balance" className="py-2 text-right font-medium tabular-nums">{formatPlain(e.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 font-semibold">
                <td className="py-2 pr-3" colSpan={3}>
                  Totals ({d.totals.entryCount} entries)
                </td>
                <td data-label="Increase" className="py-2 pr-3 text-right tabular-nums">{formatPlain(d.totals.increases)}</td>
                <td data-label="Decrease" className="py-2 pr-3 text-right tabular-nums">{formatPlain(d.totals.decreases)}</td>
                <td data-label="Balance" className="py-2 text-right tabular-nums">{formatPlain(d.closingBalance.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-500">
        Negative balances are credits (advances or overpayments). Reversed entries remain on this statement; the reversal rows correct the balance. Amounts in {symbol}.
      </p>
      <div className="mt-4 print:hidden">
        <Alert tone="info">Tip: use “Print / save as PDF” and choose “Save as PDF” as the printer to keep a copy.</Alert>
      </div>
    </div>
  );
}
