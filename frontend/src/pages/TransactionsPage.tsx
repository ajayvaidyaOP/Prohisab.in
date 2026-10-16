import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { api } from '../lib/api';
import { displayEntryLabel, formatDate, formatPlain } from '../lib/format';
import { useDebouncedValue, useSettings } from '../lib/queries';
import type { Transaction } from '../lib/types';
import { ReverseDialog } from '../components/ReverseDialog';
import { Badge, ButtonLink, Card, EmptyState, ErrorState, Field, PageHeader, Pagination, SelectInput, SkeletonRows, TextInput } from '../components/ui';

const PAGE_SIZE = 20;
const TYPE_FILTERS = [
  { value: '', label: 'All entries' },
  { value: 'CREDIT_SALE', label: 'Credit Entry (+)' },
  { value: 'PAYMENT_RECEIVED', label: 'Settlement Received (−)' },
  { value: 'CREDIT_PURCHASE', label: 'User Expense / Purchase (+)' },
  { value: 'PAYMENT_MADE', label: 'Admin Settlement (−)' },
  { value: 'REVERSAL', label: 'Reversals only' },
];
const APPROVAL_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const [reverseTx, setReverseTx] = useState<Transaction | null>(null);

  const search = params.get('search') ?? '';
  const type = params.get('type') ?? '';
  const approvalStatus = params.get('approvalStatus') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const includeReversals = params.get('reversals') !== 'hide';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const debouncedSearch = useDebouncedValue(search, 300);

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
    queryKey: ['transactions', { search: debouncedSearch, type, approvalStatus, from, to, includeReversals, page }],
    queryFn: () =>
      api.transactions.list({
        search: debouncedSearch || undefined,
        type: type || undefined,
        approvalStatus: approvalStatus || undefined,
        from: from || undefined,
        to: to || undefined,
        includeReversals,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const filtersActive = !!(search || type || approvalStatus || from || to || !includeReversals);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Every posted entry, newest first. Use Reverse to correct a mistake; original entries are never changed."
        actions={
          <ButtonLink to="/transactions/new" variant="primary">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add transaction
          </ButtonLink>
        }
      />

      <Card>
        <div className="grid gap-3 md:grid-cols-[1.8fr_1.1fr_1.1fr_1fr_1fr] md:items-end">
          <Field label="Search">
            {(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <TextInput id={id} type="search" value={search} onChange={(e) => update({ search: e.target.value })} placeholder="Account, reference or notes" className="pl-9" maxLength={100} />
              </div>
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <SelectInput id={id} value={type} onChange={(e) => update({ type: e.target.value })}>
                {TYPE_FILTERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="Approval Status">
            {(id) => (
              <SelectInput id={id} value={approvalStatus} onChange={(e) => update({ approvalStatus: e.target.value })}>
                {APPROVAL_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="From">{(id) => <TextInput id={id} type="date" value={from} max={to || undefined} disabled />}</Field>
          <Field label="To">{(id) => <TextInput id={id} type="date" value={to} min={from || undefined} disabled />}</Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={includeReversals} onChange={(e) => update({ reversals: e.target.checked ? '' : 'hide' })} />
            Include reversal entries
          </label>
          {filtersActive && (
            <button type="button" className="text-sm font-medium text-indigo-700 hover:underline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </button>
          )}
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        {query.isError ? (
          <div className="p-4 sm:p-6">
            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
          </div>
        ) : query.isPending ? (
          <SkeletonRows rows={8} cols={6} />
        ) : query.data.items.length === 0 ? (
          <div className="p-4 sm:p-6">
            {filtersActive ? (
              <EmptyState title="No transactions match these filters." description="Try a different type, status, or date range." />
            ) : (
              <EmptyState
                title="No transactions yet."
                description="Record your first credit entry or payment settlement."
                action={
                  <ButtonLink to="/transactions/new" variant="primary">
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add transaction
                  </ButtonLink>
                }
              />
            )}
          </div>
        ) : (
          <>
            <div className={`relative overflow-x-auto transition-opacity ${query.isFetching ? 'opacity-60' : ''}`} aria-busy={query.isFetching}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">Date</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Reference</th>
                    <th className="px-4 py-3 text-right">Amount ({symbol})</th>
                    <th className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {query.data.items.map((t) => {
                    const status = t.approvalStatus ?? 'APPROVED';
                    const canReverse = !t.isReversal && !t.isReversed && status === 'APPROVED';
                    const increase = t.direction === 'INCREASE';
                    return (
                      <tr key={t.id} className={`align-top ${t.isReversal ? 'bg-amber-50/40' : status === 'REJECTED' ? 'bg-slate-50 text-slate-400' : ''}`}>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(t.entryDate)}</td>
                        <td className="px-4 py-3">
                          <Link to={`/accounts/${t.account.id}`} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                            {t.account.name}
                          </Link>
                          <p className="font-mono text-xs text-slate-500">{t.account.accountCode}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={increase ? 'amber' : 'emerald'}>{displayEntryLabel(t.type, t.typeLabel)}</Badge>
                            {t.isReversal && <Badge tone="amber">Reversal</Badge>}
                            {t.isReversed && <Badge tone="slate">Reversed</Badge>}
                          </div>
                          {t.paymentMethodLabel && <p className="text-xs text-slate-500">{t.paymentMethodLabel}</p>}
                          {t.notes && <p className="max-w-xs break-words text-xs text-slate-500">{t.notes}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {t.isReversed ? (
                            <Badge tone="slate">Reversed</Badge>
                          ) : status === 'PENDING' ? (
                            <Badge tone="amber">Pending Approval</Badge>
                          ) : status === 'REJECTED' ? (
                            <div>
                              <Badge tone="rose">Rejected</Badge>
                              {t.rejectionReason ? <p className="mt-1 text-xs text-rose-600">{t.rejectionReason}</p> : null}
                            </div>
                          ) : (
                            <Badge tone="emerald">Approved</Badge>
                          )}
                        </td>
                        <td className="hidden max-w-[12rem] break-words px-4 py-3 text-slate-600 lg:table-cell">{t.referenceNumber ?? '—'}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${increase ? 'text-amber-800' : 'text-emerald-700'}`}>
                          {increase ? '+' : '−'} {formatPlain(t.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {status === 'PENDING' ? (
                            <Link to={`/accounts/${t.account.id}`} className="text-xs font-semibold text-indigo-700 hover:underline">
                              Review →
                            </Link>
                          ) : canReverse ? (
                            <button type="button" onClick={() => setReverseTx(t)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reverse
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>

      <ReverseDialog entry={reverseTx} open={!!reverseTx} onClose={() => setReverseTx(null)} />
    </div>
  );
}
