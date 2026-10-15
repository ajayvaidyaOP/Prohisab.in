import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { Download, Pencil, Printer, Plus, RotateCcw, Power } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { formatAmount, formatDate, formatPlain } from '../lib/format';
import { invalidateFinancial, useDebouncedValue, useSettings } from '../lib/queries';
import { ReverseDialog, type ReversibleEntry } from '../components/ReverseDialog';
import { Alert, Badge, BalanceBadge, Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, PageHeader, Pagination, Skeleton, StatCard, TextInput } from '../components/ui';

const PAGE_SIZE = 50;

export default function AccountDetailPage() {
  const { id } = useParams();
  const accountId = Number(id);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const qc = useQueryClient();
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const search = params.get('search') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const debouncedSearch = useDebouncedValue(search, 300);

  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [reverseEntry, setReverseEntry] = useState<ReversibleEntry | null>(null);
  const [confirmStatus, setConfirmStatus] = useState(false);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['ledger', accountId, { from, to, search: debouncedSearch, page }],
    queryFn: () => api.ledger.page(accountId, { from: from || undefined, to: to || undefined, search: debouncedSearch || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: Number.isFinite(accountId),
  });

  const toggleStatus = useMutation({
    mutationFn: (isActive: boolean) => api.accounts.setStatus(accountId, isActive),
    onSuccess: (result) => {
      invalidateFinancial(qc, accountId);
      setConfirmStatus(false);
      setFlash(result.account.isActive ? 'Account reactivated.' : 'Account deactivated. Its history is kept.');
    },
  });

  if (query.isPending && !query.data) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading account">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <EmptyState title="Account not found" description="It may have been removed, or the link is incorrect." action={<ButtonLink to="/accounts">Back to accounts</ButtonLink>} />;
    }
    return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  const account = data.account;
  const isCustomer = account.type === 'CUSTOMER';
  const hasFilters = !!(from || to || search);
  const filtered = data.filters.from || data.filters.to || data.filters.search;

  const startingLabel = from ? `Balance brought forward (before ${formatDate(from)})` : 'Opening balance';
  const startingAmount = from ? data.balanceBroughtForward.amount : data.openingBalance.amount;

  const printHref = `/accounts/${accountId}/statement${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{account.accountCode}</span>
            <Badge tone={isCustomer ? 'sky' : 'indigo'}>{account.typeLabel}</Badge>
            {account.isActive ? <Badge tone="emerald">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
            {account.phone && <span>· {account.phone}</span>}
            {account.email && <span>· {account.email}</span>}
          </span>
        }
        actions={
          <>
            <ButtonLink to={`/transactions/new?accountId=${accountId}`} variant="primary">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add transaction
            </ButtonLink>
            <ButtonLink to={`/accounts/${accountId}/edit`}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
            </ButtonLink>
            <Button variant="secondary" onClick={() => setConfirmStatus(true)}>
              <Power className="h-4 w-4" aria-hidden="true" /> {account.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        }
      />

      {flash && <Alert tone="success">{flash}</Alert>}
      {!account.isActive && (
        <Alert tone="warning" title="This account is inactive">
          History is kept and visible. New transactions are blocked until you reactivate it.
        </Alert>
      )}
      {data.crossSideEntryCount > 0 && (
        <Alert tone="warning" title="Unusual entries found">
          {data.crossSideEntryCount} entr{data.crossSideEntryCount === 1 ? 'y is' : 'ies are'} on the opposite side of this account type. Review and correct them with a reversal.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Opening balance" value={formatAmount(data.openingBalance.amount, symbol)} hint={<span>{data.openingBalance.side === 'RECEIVABLE' ? 'Receivable' : 'Payable'} · set at creation</span>} />
        <StatCard
          label={hasFilters ? 'Closing balance (period)' : 'Current balance'}
          value={formatAmount(data.closingBalance.amount, symbol)}
          tone={data.closingBalance.status === 'CREDIT' ? 'info' : data.closingBalance.status === 'DUE' ? 'warning' : 'positive'}
          hint={
            <span className="flex items-center gap-2">
              <BalanceBadge status={data.closingBalance.status} accountType={account.type} />
              <span>{data.closingBalance.side === 'RECEIVABLE' ? 'Receivable' : 'Payable'}</span>
            </span>
          }
        />
        <StatCard label="Total increases" value={formatAmount(data.totals.increases, symbol)} hint={`${data.totals.entryCount} entr${data.totals.entryCount === 1 ? 'y' : 'ies'} in view`} />
        <StatCard label="Total decreases" value={formatAmount(data.totals.decreases, symbol)} hint={`Net change ${formatAmount(data.totals.net, symbol)}`} />
      </div>

      {account.balance.status === 'CREDIT' && (
        <Alert tone="info" title={isCustomer ? 'This customer has a credit balance' : 'You have a credit with this supplier'}>
          The amount is shown as a negative balance and is not hidden. It can be used against future {isCustomer ? 'sales' : 'purchases'}.
        </Alert>
      )}

      <Card>
        <div className="grid gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))_1fr_auto] md:items-end">
          <Field label="From">{(id) => <TextInput id={id} type="date" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <TextInput id={id} type="date" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />}</Field>
          <Field label="Search">{(id) => <TextInput id={id} type="search" placeholder="Reference, notes, method" value={search} maxLength={100} onChange={(e) => update({ search: e.target.value })} />}</Field>
          <div className="flex flex-wrap gap-2 print:hidden">
            {hasFilters && (
              <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          <a href={printHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="h-4 w-4" aria-hidden="true" /> Printable statement
          </a>
          <a href={api.ledger.csvUrl(accountId, { from: from || undefined, to: to || undefined, search: debouncedSearch || undefined })} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" download>
            <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
          </a>
          {filtered && <span className="self-center text-xs text-slate-500">Exports and statements use the current filters.</span>}
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <h2 className="text-base font-semibold text-slate-900">Ledger</h2>
          <span className="text-xs text-slate-500">Oldest first · running balance after each entry</span>
        </div>
        {query.isFetching && query.data && <div className="h-0.5 animate-pulse bg-indigo-400" aria-hidden="true" />}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Date</th>
                <th className="px-4 py-3">Description</th>
                <th className="hidden px-4 py-3 md:table-cell">Reference</th>
                <th className="px-4 py-3 text-right">Increase</th>
                <th className="px-4 py-3 text-right">Decrease</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right print:hidden"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              <tr className="bg-slate-50/60 text-slate-700">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs" colSpan={5}>
                  <span className="font-medium">{startingLabel}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums" colSpan={1}>
                  {formatPlain(startingAmount)}
                </td>
                <td className="print:hidden" />
              </tr>
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10">
                    {hasFilters ? (
                      <EmptyState title="No entries match these filters." description="Try a wider date range or clear the search." />
                    ) : (
                      <EmptyState
                        title="No transactions yet."
                        description={isCustomer ? 'Record a credit sale or a payment received to start this customer’s ledger.' : 'Record a credit purchase or a payment made to start this supplier’s ledger.'}
                        action={
                          <ButtonLink to={`/transactions/new?accountId=${accountId}`} variant="primary">
                            <Plus className="h-4 w-4" aria-hidden="true" /> Add transaction
                          </ButtonLink>
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
              {data.entries.map((e) => {
                const increase = e.direction === 'INCREASE';
                const canReverse = !e.isReversal && !e.isReversed;
                return (
                  <tr key={e.id} className={`align-top ${e.isReversal ? 'bg-amber-50/40' : ''} ${e.crossSide ? 'bg-rose-50' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(e.entryDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-slate-900">{e.typeLabel}</span>
                        {e.isReversal && <Badge tone="amber">Reversal</Badge>}
                        {e.isReversed && <Badge tone="slate">Reversed</Badge>}
                        {e.paymentMethodLabel && <Badge tone="sky">{e.paymentMethodLabel}</Badge>}
                      </div>
                      {e.isReversal && e.reversalOfId && <p className="mt-0.5 text-xs text-slate-500">Reverses entry #{e.reversalOfId}</p>}
                      {e.notes && <p className="mt-0.5 whitespace-pre-line break-words text-xs text-slate-600">{e.notes}</p>}
                      <p className="mt-0.5 text-[11px] text-slate-400 md:hidden">{e.referenceNumber ?? ''}</p>
                    </td>
                    <td className="hidden max-w-[12rem] break-words px-4 py-3 text-slate-600 md:table-cell">{e.referenceNumber ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-amber-800">{increase ? formatPlain(e.amount) : ''}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{!increase ? formatPlain(e.amount) : ''}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatPlain(e.runningBalance)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right print:hidden">
                      {canReverse && (
                        <button type="button" onClick={() => setReverseEntry(e)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.entries.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={3}>
                    {filtered ? 'Totals for this view' : 'Totals'} ({data.totals.entryCount} entries)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-800">{formatPlain(data.totals.increases)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatPlain(data.totals.decreases)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatPlain(data.closingBalance.amount)}</td>
                  <td className="print:hidden" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={(p) => update({ page: String(p) })} />
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 sm:px-6">
          Balance column: after this entry, on the account's normal side ({data.closingBalance.side === 'RECEIVABLE' ? 'receivable' : 'payable'}). Negative values are credits.
        </p>
      </Card>

      <ReverseDialog entry={reverseEntry} accountId={accountId} open={!!reverseEntry} onClose={() => setReverseEntry(null)} />

      <Dialog
        open={confirmStatus}
        title={account.isActive ? 'Deactivate this account?' : 'Reactivate this account?'}
        onClose={() => setConfirmStatus(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmStatus(false)} disabled={toggleStatus.isPending}>
              Cancel
            </Button>
            <Button variant={account.isActive ? 'danger' : 'primary'} loading={toggleStatus.isPending} onClick={() => toggleStatus.mutate(!account.isActive)}>
              {account.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          {account.isActive
            ? 'Accounts with transactions are never deleted. Deactivating keeps all history and the balance, but blocks new transactions until you reactivate it.'
            : 'New transactions will be allowed on this account again.'}
        </p>
        {toggleStatus.error && <Alert tone="error">{toggleStatus.error.message}</Alert>}
      </Dialog>

    </div>
  );
}
