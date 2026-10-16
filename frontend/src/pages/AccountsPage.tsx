import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { FileDown, Pencil, Plus, Search, UserPlus, Wallet } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { formatPlain } from '../lib/format';
import { useDebouncedValue, useSettings } from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonRows,
  TextInput,
} from '../components/ui';

const PAGE_SIZE = 20;

export default function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { flash?: string } | null;
  const [downloadingPdfId, setDownloadingPdfId] = useState<number | null>(null);
  const [downloadingSummaryPdf, setDownloadingSummaryPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const search = params.get('search') ?? '';
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

  const handleDownloadPdf = async (id: number, name: string) => {
    try {
      setPdfError(null);
      setDownloadingPdfId(id);
      await api.ledger.downloadPdf(id, name);
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : 'Could not download PDF.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const handleDownloadSummaryPdf = async () => {
    try {
      setPdfError(null);
      setDownloadingSummaryPdf(true);
      await api.ledger.downloadAllUsersSummaryPdf();
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : 'Could not download All Users Summary PDF.');
    } finally {
      setDownloadingSummaryPdf(false);
    }
  };

  const query = useQuery({
    queryKey: ['accounts', 'list', { search: debouncedSearch, status, page }],
    queryFn: () =>
      api.accounts.list({
        search: debouncedSearch || undefined,
        status,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Ledgers"
        description="Create users (Name & Password), view Deposit & Withdrawal ledgers, and download PDF statements."
        actions={
          <>
            <Button variant="secondary" loading={downloadingSummaryPdf} onClick={() => void handleDownloadSummaryPdf()}>
              <FileDown className="h-4 w-4" aria-hidden="true" /> All Users Summary PDF
            </Button>
            <ButtonLink to="/accounts/new" variant="primary">
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Create New User
            </ButtonLink>
          </>
        }
      />

      {navState?.flash ? <Alert tone="success">{navState.flash}</Alert> : null}
      {pdfError ? <Alert tone="error">{pdfError}</Alert> : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Search User">
            {(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <TextInput
                  id={id}
                  type="search"
                  placeholder="User name or code"
                  value={search}
                  onChange={(e) => update({ search: e.target.value })}
                  className="pl-9"
                  maxLength={100}
                />
              </div>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <SelectInput id={id} value={status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
                <option value="all">All Users</option>
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
          <SkeletonRows rows={6} cols={6} />
        ) : query.data.items.length === 0 ? (
          <div className="p-4 sm:p-6">
            {search || status !== 'all' ? (
              <EmptyState title="No users match these filters." description="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No users created yet."
                description="Create your first user with just a Name and Password."
                action={
                  <ButtonLink to="/accounts/new" variant="primary">
                    <Plus className="h-4 w-4" aria-hidden="true" /> Create First User
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
                    <th className="px-4 py-3">User Name</th>
                    <th className="px-4 py-3 text-right">Total Deposit (+ {symbol})</th>
                    <th className="px-4 py-3 text-right">Total Withdraw (- {symbol})</th>
                    <th className="px-4 py-3 text-right">Net Balance ({symbol})</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Status</th>
                    <th className="px-4 py-3 text-right">Actions & PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {query.data.items.map((a) => {
                    const hasPending = Number(a.pendingBalance) > 0;
                    return (
                      <tr
                        key={a.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a,button')) return;
                          void navigate(`/accounts/${a.id}`);
                        }}
                      >
                        <td className="px-4 py-3">
                          <Link to={`/accounts/${a.id}`} className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline">
                            {a.name}
                          </Link>
                          <p className="font-mono text-xs text-slate-400">{a.accountCode}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-indigo-700">
                          {formatPlain(a.totalUserPaid)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-emerald-700">
                          {formatPlain(a.totalAdminPaid)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className={`font-bold tabular-nums ${hasPending ? 'text-amber-700' : 'text-slate-800'}`}>
                            {formatPlain(a.pendingBalance)}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          {a.isActive ? <Badge tone="emerald">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              variant="secondary"
                              className="!px-2.5 !py-1 text-xs"
                              loading={downloadingPdfId === a.id}
                              onClick={() => void handleDownloadPdf(a.id, a.name)}
                            >
                              <FileDown className="h-3.5 w-3.5" /> Download PDF
                            </Button>
                            <ButtonLink to={`/accounts/${a.id}`} variant="primary" className="!px-2.5 !py-1 text-xs">
                              <Wallet className="h-3.5 w-3.5" /> Ledger
                            </ButtonLink>
                            <ButtonLink to={`/accounts/${a.id}/edit`} variant="secondary" className="!px-2.5 !py-1 text-xs">
                              <Pencil className="h-3.5 w-3.5" /> Edit / Pass
                            </ButtonLink>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={query.data.pagination.page}
              totalPages={query.data.pagination.totalPages}
              total={query.data.pagination.total}
              onChange={(p) => update({ page: String(p) })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
