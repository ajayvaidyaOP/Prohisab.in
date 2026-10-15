import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { formatPlain } from '../lib/format';
import { useDebouncedValue, useSettings } from '../lib/queries';
import { Badge, BalanceBadge, ButtonLink, Card, EmptyState, ErrorState, Field, PageHeader, Pagination, SelectInput, SkeletonRows, TextInput } from '../components/ui';

const PAGE_SIZE = 20;

export default function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const search = params.get('search') ?? '';
  const type = params.get('type') ?? '';
  const status = params.get('status') ?? 'all';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const debouncedSearch = useDebouncedValue(search, 300);
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['accounts', 'list', { search: debouncedSearch, type, status, page }],
    queryFn: () =>
      api.accounts.list({
        search: debouncedSearch || undefined,
        type: type || undefined,
        status,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Customers (receivables) and suppliers (payables). Balances are calculated from the ledger."
        actions={
          <ButtonLink to="/accounts/new" variant="primary">
            <Plus className="h-4 w-4" aria-hidden="true" /> New account
          </ButtonLink>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
          <Field label="Search">
            {(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <TextInput
                  id={id}
                  type="search"
                  placeholder="Name, code, phone or email"
                  value={search}
                  onChange={(e) => update({ search: e.target.value })}
                  className="pl-9"
                  maxLength={100}
                />
              </div>
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <SelectInput id={id} value={type} onChange={(e) => update({ type: e.target.value })}>
                <option value="">All types</option>
                <option value="CUSTOMER">Customers</option>
                <option value="SUPPLIER">Suppliers</option>
              </SelectInput>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <SelectInput id={id} value={status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectInput>
            )}
          </Field>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        {query.isError ? (
          <div className="p-4 sm:p-6">
            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
          </div>
        ) : query.isPending ? (
          <SkeletonRows rows={6} cols={5} />
        ) : query.data.items.length === 0 ? (
          <div className="p-4 sm:p-6">
            {search || type || status !== 'all' ? (
              <EmptyState title="No accounts match these filters." description="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No accounts yet."
                description="Add your first customer or supplier. You can enter an opening balance when you create it."
                action={
                  <ButtonLink to="/accounts/new" variant="primary">
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add account
                  </ButtonLink>
                }
              />
            )}
          </div>
        ) : (
          <>
            <div className={`overflow-x-auto transition-opacity ${query.isFetching ? 'opacity-60' : ''}`} aria-busy={query.isFetching}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="hidden px-4 py-3 md:table-cell">Type</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Phone</th>
                    <th className="px-4 py-3 text-right">Current balance ({symbol})</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {query.data.items.map((a) => (
                    <tr
                      key={a.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        void navigate(`/accounts/${a.id}`);
                      }}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{a.accountCode}</td>
                      <td className="px-4 py-3">
                        <Link to={`/accounts/${a.id}`} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                          {a.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 md:hidden">
                          <Badge tone={a.type === 'CUSTOMER' ? 'sky' : 'indigo'}>{a.typeLabel}</Badge>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <Badge tone={a.type === 'CUSTOMER' ? 'sky' : 'indigo'}>{a.typeLabel}</Badge>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-slate-600 lg:table-cell">{a.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-semibold tabular-nums text-slate-900">{formatPlain(a.balance.amount)}</p>
                        <div className="mt-1 flex justify-end">
                          <BalanceBadge status={a.balance.status} accountType={a.type} />
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {a.isActive ? <Badge tone="emerald">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>
    </div>
  );
}
