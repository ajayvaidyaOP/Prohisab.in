import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ClipboardList,
  FileDown,
  KeyRound,
  Scale,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { formatAmount, formatDate, getMonthRange, PAYMENT_METHOD_OPTIONS } from '../lib/format';
import { invalidateFinancial, useSettings } from '../lib/queries';
import type { DashboardUserOverview, PaymentMethod, Transaction } from '../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SelectInput,
  SkeletonRows,
  TextInput,
} from '../components/ui';

type DashboardFilter = { from?: string; to?: string; bookId?: number; userId?: number };

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [pdfFrom, setPdfFrom] = useState('');
  const [pdfTo, setPdfTo] = useState('');
  const [pdfBookId] = useState('');
  const [pdfUserId, setPdfUserId] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilter>({});
  const [filterInitialized, setFilterInitialized] = useState(false);

  useEffect(() => {
    if (!settings.data?.today) return;
    setPdfFrom(settings.data.today);
    setPdfTo(settings.data.today);
    setAppliedFilters({ from: settings.data.today, to: settings.data.today });
    setFilterInitialized(true);
  }, [settings.data?.today, filterInitialized]);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', 'filtered', appliedFilters],
    queryFn: () => api.dashboard(appliedFilters),
  });
  const { data, isPending, isError, error, refetch } = dashboardQuery;
  const filterUsersQuery = useQuery({
    queryKey: ['dashboard-filter-users'],
    queryFn: () => api.accounts.options({}),
  });
  const booksQuery = useQuery({ queryKey: ['books'], queryFn: api.books.list });

  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Quick Deposit / Withdrawal Modal
  const [settleTarget, setSettleTarget] = useState<DashboardUserOverview | null>(null);
  const [settleKind, setSettleKind] = useState<'WITHDRAWAL' | 'DEPOSIT'>('WITHDRAWAL');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(() => data?.today ?? new Date().toISOString().slice(0, 10));
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('UPI');
  const [settleNotes, setSettleNotes] = useState('');
  const [settleRef, setSettleRef] = useState('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  // Quick Password Change Modal
  const [passTarget, setPassTarget] = useState<DashboardUserOverview | null>(null);
  const [newPassValue, setNewPassValue] = useState('');
  const [passError, setPassError] = useState<string | null>(null);

  // Quick Reject Modal
  const [rejectTarget, setRejectTarget] = useState<Transaction | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  // PDF Download States (All Users Summary PDF + Month Filter in Bottom Table)
  const [pdfPeriod, setPdfPeriod] = useState<'ALL' | 'THIS_MONTH' | 'LAST_MONTH'>('ALL');
  const [downloadingPdfId, setDownloadingPdfId] = useState<number | null>(null);
  const [downloadingSummaryPdf, setDownloadingSummaryPdf] = useState(false);

  const passwordResetMutation = useMutation({
    mutationFn: () => api.accounts.resetPassword(passTarget!.id, { newPassword: newPassValue, confirmPassword: newPassValue }),
    onSuccess: () => {
      invalidateFinancial(queryClient, passTarget!.id);
      setFlashMessage(`Password updated for "${passTarget!.name}". Share the new password securely.`);
      setPassTarget(null);
      setNewPassValue('');
      setPassError(null);
    },
    onError: (err) => {
      setPassError(err instanceof ApiError ? err.message : 'Could not update password.');
    },
  });

  const onPassResetSubmit = (e: FormEvent) => {
    e.preventDefault();
    setPassError(null);
    if (newPassValue.length < 6 || !/[A-Za-z]/.test(newPassValue) || !/\d/.test(newPassValue)) {
      setPassError('Use at least 6 characters with both letters and numbers.');
      return;
    }
    passwordResetMutation.mutate();
  };

  const handleDownloadPdf = async (userId: number, userName: string) => {
    const todayStr = data?.today ?? new Date().toISOString().slice(0, 10);
    let params: { from?: string; to?: string } = {};
    if (pdfPeriod === 'THIS_MONTH') {
      const r = getMonthRange(todayStr, 0);
      params = { from: r.from, to: r.to };
    } else if (pdfPeriod === 'LAST_MONTH') {
      const r = getMonthRange(todayStr, -1);
      params = { from: r.from, to: r.to };
    }
    try {
      setDownloadingPdfId(userId);
      await api.ledger.downloadPdf(userId, userName, params);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Could not download PDF.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const applyDashboardFilters = () => {
    setErrorMessage(null);
    if (pdfFrom && pdfTo && pdfFrom > pdfTo) {
      setErrorMessage('From date must be on or before To date.');
      return;
    }
    setAppliedFilters({
      from: pdfFrom || undefined,
      to: pdfTo || undefined,
      bookId: pdfBookId ? Number(pdfBookId) : undefined,
      userId: pdfUserId ? Number(pdfUserId) : undefined,
    });
  };

  const handleDownloadSummaryPdf = async () => {
    try {
      setDownloadingSummaryPdf(true);
      await api.ledger.downloadAllUsersSummaryPdf(appliedFilters);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Could not download All Users Summary PDF.');
    } finally {
      setDownloadingSummaryPdf(false);
    }
  };

  const openSettleModal = (u: DashboardUserOverview, kind: 'WITHDRAWAL' | 'DEPOSIT' = 'WITHDRAWAL') => {
    setSettleTarget(u);
    setSettleKind(kind);
    const pendingNum = Number(u.pendingBalance);
    setSettleAmount(kind === 'WITHDRAWAL' && pendingNum > 0 ? u.pendingBalance : '');
    setSettleDate(data?.today ?? new Date().toISOString().slice(0, 10));
    setSettleMethod('UPI');
    setSettleNotes('');
    setSettleRef('');
    setSettleError(null);
    setIdempotencyKey(newIdempotencyKey());
  };

  const settleMutation = useMutation({
    mutationFn: () => {
      const isSupplier = settleTarget!.type === 'SUPPLIER';
      const txType =
        settleKind === 'DEPOSIT'
          ? isSupplier
            ? 'CREDIT_PURCHASE'
            : 'CREDIT_SALE'
          : isSupplier
            ? 'PAYMENT_MADE'
            : 'PAYMENT_RECEIVED';
      const defaultNote =
        settleKind === 'DEPOSIT'
          ? `Deposit (+) recorded for ${settleTarget!.name}`
          : `Withdrawal (-) recorded for ${settleTarget!.name}`;
      return api.transactions.create(
        {
          accountId: settleTarget!.id,
          type: txType,
          entryDate: settleDate,
          amount: settleAmount,
          paymentMethod: settleMethod,
          referenceNumber: settleRef.trim() || null,
          notes: settleNotes.trim() || defaultNote,
        },
        idempotencyKey,
      );
    },
    onSuccess: (res) => {
      invalidateFinancial(queryClient, settleTarget!.id);
      const label = settleKind === 'DEPOSIT' ? 'Deposit (+)' : 'Withdrawal (-)';
      setFlashMessage(
        `Recorded ${formatAmount(res.transaction.amount, data?.currencySymbol ?? '₹')} ${label} for ${settleTarget!.name}.`,
      );
      setSettleTarget(null);
    },
    onError: (err) => {
      setSettleError(err instanceof ApiError ? err.message : 'Could not record transaction.');
    },
  });

  const approveMutation = useMutation({
    mutationFn: (entry: Transaction) => api.transactions.approve(entry.id, newIdempotencyKey()),
    onSuccess: (res) => {
      invalidateFinancial(queryClient, res.transaction.account.id);
      const isDeposit = res.transaction.direction === 'INCREASE';
      setFlashMessage(
        `Approved ${isDeposit ? 'Deposit (+)' : 'Withdrawal (-)'} of ${formatAmount(res.transaction.amount, data?.currencySymbol ?? '₹')} for ${res.transaction.account.name}.`,
      );
    },
    onError: (err) => {
      setErrorMessage(err instanceof ApiError ? err.message : 'Could not approve entry.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      api.transactions.reject(rejectTarget!.id, { reason: rejectReason.trim() }, newIdempotencyKey()),
    onSuccess: (res) => {
      invalidateFinancial(queryClient, res.transaction.account.id);
      setFlashMessage(`Rejected entry #${res.transaction.id} (${res.transaction.account.name}).`);
      setRejectTarget(null);
      setRejectReason('');
      setRejectError(null);
    },
    onError: (err) => {
      setRejectError(err instanceof ApiError ? err.message : 'Could not reject entry.');
    },
  });

  const onSettleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSettleError(null);
    if (!settleAmount.trim() || Number(settleAmount) <= 0) {
      setSettleError('Enter a valid amount greater than 0.');
      return;
    }
    settleMutation.mutate();
  };

  const onRejectSubmit = (e: FormEvent) => {
    e.preventDefault();
    setRejectError(null);
    if (rejectReason.trim().length < 2) {
      setRejectError('Please enter a short reason for rejection (at least 2 characters).');
      return;
    }
    rejectMutation.mutate();
  };

  if (isPending) {
    return (
      <Card padded={false}>
        <SkeletonRows rows={6} cols={5} />
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Could not load dashboard.'}
        onRetry={() => void refetch()}
      />
    );
  }

  const symbol = data.currencySymbol;
  const totals = data.userLedgerTotals ?? {
    totalUserPaid: data.payables.total,
    totalAdminPaid: data.todayPayments.paid,
    totalPending: data.payables.total,
    pendingSubmissionsCount: 0,
    pendingSubmissionsAmount: '0.00',
    todayUserPaid: '0.00',
    todayUserPaidCount: 0,
    todayAdminPaid: data.todayPayments.paid,
    todayAdminPaidCount: data.todayPayments.paidCount,
  };

  const usersList = data.usersOverview ?? [];
  const pendingEntries = data.pendingEntries ?? [];
  const thisMonthInfo = getMonthRange(data.today, 0);
  const lastMonthInfo = getMonthRange(data.today, -1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Deposit & Withdrawal Dashboard"
        description={`Today · ${formatDate(data.today)} · Review activity, manage users and download reports`}
      />

      {flashMessage ? <Alert tone="success">{flashMessage}</Alert> : null}
      {errorMessage ? <Alert tone="error">{errorMessage}</Alert> : null}

      <Card padded={false} className="border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Report filters</h2>
          <p className="mt-0.5 text-xs text-slate-500">Choose a user, then apply to refresh the dashboard totals and PDF report.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="From Date">
            {(id) => <TextInput id={id} type="date" value={pdfFrom} max={pdfTo || undefined} disabled />}
          </Field>
          <Field label="To Date">
            {(id) => <TextInput id={id} type="date" value={pdfTo} min={pdfFrom || undefined} disabled />}
          </Field>
          <Field label="Book">
            {(id) => (
              <SelectInput id={id} value={pdfBookId} disabled>
                <option value="">All books</option>
                {(booksQuery.data ?? []).map((book) => (
                  <option key={book.id} value={book.id}>{book.name}{book.status === 'ARCHIVED' ? ' (Archived)' : ''}</option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="User">
            {(id) => (
              <SelectInput id={id} value={pdfUserId} onChange={(e) => setPdfUserId(e.target.value)}>
                <option value="">All users</option>
                {(filterUsersQuery.data?.items ?? []).map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">Totals, entries and reports use the applied filters.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={dashboardQuery.isFetching} onClick={applyDashboardFilters}>Apply</Button>
            <Button variant="secondary" loading={downloadingSummaryPdf} onClick={() => void handleDownloadSummaryPdf()}>
              <FileDown className="h-3.5 w-3.5" /> Print / Save PDF Report
            </Button>
          </div>
        </div>
      </Card>

      {/* Filtered dashboard totals */}
      <section className="space-y-3" aria-label="Dashboard summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card
            padded={false}
            className="border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Deposits (+)</p>
                <p className="mt-3 break-words font-mono text-2xl font-bold leading-tight tabular-nums tracking-tight text-emerald-700">
                  {formatAmount(totals.totalUserPaid, symbol)}
                </p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                <TrendingUp className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 border-t border-emerald-100 pt-3 text-xs text-slate-500">Approved deposits · applied filters</p>
          </Card>

          <Card
            padded={false}
            className="border-rose-200/80 bg-gradient-to-br from-white to-rose-50/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Withdrawals (-)</p>
                <p className="mt-3 break-words font-mono text-2xl font-bold leading-tight tabular-nums tracking-tight text-rose-700">
                  {formatAmount(totals.totalAdminPaid, symbol)}
                </p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700">
                <TrendingDown className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 border-t border-rose-100 pt-3 text-xs text-slate-500">Approved withdrawals · applied filters</p>
          </Card>

          <Card
            padded={false}
            className="border-indigo-200/80 bg-gradient-to-br from-white to-indigo-50/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Net Balance</p>
                <p className="mt-3 break-words font-mono text-2xl font-bold leading-tight tabular-nums tracking-tight text-indigo-700">
                  {formatAmount(totals.totalPending, symbol)}
                </p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
                <Scale className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 border-t border-indigo-100 pt-3 text-xs text-slate-500">Deposit - Withdraw</p>
          </Card>

          <Card
            padded={false}
            className="border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Entries</p>
                <p className="mt-3 break-words font-mono text-2xl font-bold leading-tight tabular-nums tracking-tight text-slate-800">
                  {data.counts.ledgerEntries ?? 0}
                </p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                <ClipboardList className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Approved deposit / withdrawal entries</p>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="User and book counts">
          <div className="inline-flex items-center gap-2 rounded-xl border border-sky-100 bg-white/90 px-3 py-2 shadow-sm">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-50 text-sky-700">
              <Users className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-xs font-medium text-slate-600">Users</span>
            <span className="text-sm font-bold tabular-nums text-slate-900">{data.counts.totalUsers ?? 0}</span>
            <span className="text-xs text-slate-400">· {data.counts.activeUsers ?? 0} active</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-violet-100 bg-white/90 px-3 py-2 shadow-sm">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-700">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-xs font-medium text-slate-600">Books</span>
            <span className="text-sm font-bold tabular-nums text-slate-900">{data.counts.activeBooks ?? 0}</span>
            <span className="text-xs text-slate-400">active</span>
          </div>
        </div>
      </section>

      {/* Pending Submissions Queue (Admin Approval Section) */}
      {pendingEntries.length > 0 ? (
        <Card padded={false} className="overflow-hidden border-amber-300">
          <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Pending Withdrawal Requests — Awaiting Approval ({pendingEntries.length})
              </h2>
              <p className="text-xs text-slate-600">
                User-submitted withdrawals (-) update the balance after you approve them.
              </p>
            </div>
            <Badge tone="amber">{pendingEntries.length} pending</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Request Type</th>
                  <th className="px-4 py-3">Selected Option & Detail</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Review Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {pendingEntries.map((entry) => {
                  const isDeposit = entry.direction === 'INCREASE';
                  return (
                    <tr key={entry.id} className="hover:bg-amber-50/30">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(entry.entryDate)}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/accounts/${entry.account.id}`}
                          className="font-semibold text-slate-900 hover:text-indigo-700"
                        >
                          {entry.account.name}
                        </Link>
                        <div className="font-mono text-xs text-slate-400">{entry.account.accountCode}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {isDeposit ? (
                          <Badge tone="emerald">+ Deposit</Badge>
                        ) : (
                          <Badge tone="rose">- Withdrawal</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-800 font-medium">{entry.notes || entry.typeLabel}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {entry.paymentMethodLabel || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-bold">
                        <span className={isDeposit ? 'text-emerald-700' : 'text-rose-700'}>
                          {isDeposit ? '+' : '-'} {formatAmount(entry.amount, symbol)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Button
                            className="!py-1 !px-2.5 text-xs"
                            loading={approveMutation.isPending}
                            onClick={() => approveMutation.mutate(entry)}
                          >
                            ✓ Approve
                          </Button>
                          <Button
                            variant="danger"
                            className="!py-1 !px-2.5 text-xs"
                            onClick={() => {
                              setRejectTarget(entry);
                              setRejectReason('');
                              setRejectError(null);
                            }}
                          >
                            ✕ Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Quick Password Reset Modal */}
      {passTarget ? (
        <Card className="border-2 border-indigo-600 bg-indigo-50/40">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Change Password for User: {passTarget.name} (Login Name: {passTarget.username ?? passTarget.name})
              </h2>
              <p className="text-xs text-slate-600">
                Users cannot change their own password. Enter the new password below and click Save.
              </p>
            </div>
            <Button variant="ghost" onClick={() => setPassTarget(null)}>
              Close
            </Button>
          </div>
          {passError ? (
            <div className="mt-3">
              <Alert tone="error">{passError}</Alert>
            </div>
          ) : null}
          <form onSubmit={onPassResetSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label={`New Password for ${passTarget.name}`} required>
                {(fid) => (
                  <TextInput
                    id={fid}
                    type="password"
                    placeholder="At least 6 characters with letters and numbers"
                    value={newPassValue}
                    onChange={(e) => setNewPassValue(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button type="submit" loading={passwordResetMutation.isPending}>
              Save New Password
            </Button>
          </form>
        </Card>
      ) : null}

      {/* Quick Reject Modal */}
      {rejectTarget ? (
        <Card className="border-2 border-rose-500 bg-rose-50/40">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Reject Entry #{rejectTarget.id} — {rejectTarget.account.name} ({formatAmount(rejectTarget.amount, symbol)})
              </h2>
              <p className="text-xs text-slate-600">
                Rejected entries remain visible in the history with your rejection reason and do not change the user’s balance.
              </p>
            </div>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
          </div>
          {rejectError ? (
            <div className="mt-3">
              <Alert tone="error">{rejectError}</Alert>
            </div>
          ) : null}
          <form onSubmit={onRejectSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Reason for Rejection" required>
                {(fid) => (
                  <TextInput
                    id={fid}
                    placeholder="e.g. Duplicate entry / Wrong amount"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button type="submit" variant="danger" loading={rejectMutation.isPending}>
              Confirm Reject
            </Button>
          </form>
        </Card>
      ) : null}

      {/* Quick Deposit / Withdrawal Modal */}
      {settleTarget ? (
        <Card
          className={
            settleKind === 'DEPOSIT'
              ? 'border-2 border-emerald-600 bg-emerald-50/40'
              : 'border-2 border-rose-600 bg-rose-50/40'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {settleKind === 'DEPOSIT'
                  ? `+ Record Deposit for ${settleTarget.name}`
                  : `- Record Withdrawal / Payout for ${settleTarget.name}`}
              </h2>
              <p className="text-xs text-slate-600">
                Total Deposit (+): {formatAmount(settleTarget.totalUserPaid, symbol)} · Total Withdrawal (-):{' '}
                {formatAmount(settleTarget.totalAdminPaid, symbol)} · Net Balance:{' '}
                <strong>{formatAmount(settleTarget.pendingBalance, symbol)}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                <button
                  type="button"
                  onClick={() => {
                    setSettleKind('DEPOSIT');
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                    settleKind === 'DEPOSIT' ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ArrowDownLeft className="h-3.5 w-3.5" /> + Deposit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettleKind('WITHDRAWAL');
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                    settleKind === 'WITHDRAWAL' ? 'bg-rose-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" /> - Withdrawal
                </button>
              </div>
              <Button variant="ghost" onClick={() => setSettleTarget(null)}>
                Close
              </Button>
            </div>
          </div>

          {settleError ? (
            <div className="mt-3">
              <Alert tone="error">{settleError}</Alert>
            </div>
          ) : null}

          <form onSubmit={onSettleSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={`${settleKind === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} Amount`} required>
              {(fid) => (
                <TextInput
                  id={fid}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={settleAmount}
                  onChange={(e) => {
                    setSettleAmount(e.target.value);
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                />
              )}
            </Field>
            <Field label="Date" required>
              {(fid) => (
                <TextInput
                  id={fid}
                  type="date"
                  max={data.today}
                  value={settleDate}
                  disabled
                />
              )}
            </Field>
            <Field label="Payment Mode">
              {(fid) => (
                <SelectInput
                  id={fid}
                  value={settleMethod}
                  onChange={(e) => {
                    setSettleMethod(e.target.value as PaymentMethod);
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                >
                  {PAYMENT_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Option / Remark">
              {(fid) => (
                <TextInput
                  id={fid}
                  placeholder={settleKind === 'DEPOSIT' ? 'e.g. Cash Deposit' : 'e.g. UPI Withdrawal'}
                  value={settleNotes}
                  onChange={(e) => {
                    setSettleNotes(e.target.value);
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                />
              )}
            </Field>
            <Field label="Ref / UTR (Optional)">
              {(fid) => (
                <div className="flex gap-2">
                  <TextInput
                    id={fid}
                    placeholder="UTR / Ref"
                    value={settleRef}
                    onChange={(e) => {
                      setSettleRef(e.target.value);
                      setIdempotencyKey(newIdempotencyKey());
                    }}
                  />
                  <Button
                    type="submit"
                    variant={settleKind === 'DEPOSIT' ? 'primary' : 'danger'}
                    loading={settleMutation.isPending}
                    className="shrink-0"
                  >
                    Save
                  </Button>
                </div>
              )}
            </Field>
          </form>
        </Card>
      ) : null}

      {/* All Users Ledger Table (Bottom Section with All Users Summary PDF Button) */}
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              All Users — Deposits (+), Withdrawals (-), Password & PDF Download
            </h2>
            <p className="text-xs text-slate-500">
              Choose PDF Period ({pdfPeriod === 'ALL' ? 'All Time' : pdfPeriod === 'THIS_MONTH' ? thisMonthInfo.label : lastMonthInfo.label}) and click &ldquo;PDF&rdquo; on any user, or download All Users Summary PDF
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 1-Click PDF Period Selector */}
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setPdfPeriod('ALL')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  pdfPeriod === 'ALL' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={() => setPdfPeriod('THIS_MONTH')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  pdfPeriod === 'THIS_MONTH' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                This Month ({thisMonthInfo.label})
              </button>
              <button
                type="button"
                onClick={() => setPdfPeriod('LAST_MONTH')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  pdfPeriod === 'LAST_MONTH' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Last Month ({lastMonthInfo.label})
              </button>
            </div>

            <Button
              variant="secondary"
              className="!py-1 !px-3 text-xs"
              loading={downloadingSummaryPdf}
              onClick={() => void handleDownloadSummaryPdf()}
            >
              <FileDown className="h-3.5 w-3.5" /> All Users Summary PDF
            </Button>
          </div>
        </div>

        {usersList.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No users created yet"
              description="Click 'Create User' in the top bar to create your first user with just a Name and Password."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">User Name (Login ID)</th>
                  <th className="px-4 py-3 text-right">Total Deposit (+)</th>
                  <th className="px-4 py-3 text-right">Total Withdraw (-)</th>
                  <th className="px-4 py-3 text-right">Net Balance</th>
                  <th className="px-4 py-3 text-right">Pending Review</th>
                  <th className="px-4 py-3 text-right">Actions, Pass & PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {usersList.map((u) => {
                  const pendingNum = Number(u.pendingBalance);
                  const pendingSubCount = u.pendingSubmissionsCount ?? 0;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <Link to={`/accounts/${u.id}`} className="font-semibold text-slate-900 hover:text-indigo-700">
                          {u.name}
                        </Link>
                        <div className="text-xs text-slate-400 font-mono">
                          {u.accountCode} {u.username ? `· Login: ${u.username}` : ''}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-emerald-700">
                        + {formatAmount(u.totalUserPaid, symbol)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-rose-700">
                        - {formatAmount(u.totalAdminPaid, symbol)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-bold">
                        <span
                          className={
                            pendingNum > 0
                              ? 'text-indigo-700'
                              : pendingNum < 0
                                ? 'text-rose-700'
                                : 'text-slate-500'
                          }
                        >
                          {formatAmount(u.pendingBalance, symbol)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {pendingSubCount > 0 ? (
                          <Badge tone="amber">
                            {pendingSubCount} ({formatAmount(u.pendingSubmissionsAmount ?? '0.00', symbol)})
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            variant="secondary"
                            className="!py-1 !px-2 text-xs"
                            onClick={() => openSettleModal(u, 'DEPOSIT')}
                            title="Record Deposit (+)"
                          >
                            + Deposit
                          </Button>
                          <Button
                            variant="secondary"
                            className="!py-1 !px-2 text-xs"
                            onClick={() => openSettleModal(u, 'WITHDRAWAL')}
                            title="Record Withdrawal (-)"
                          >
                            - Withdraw
                          </Button>
                          <Button
                            variant="secondary"
                            className="!py-1 !px-2 text-xs"
                            onClick={() => {
                              setPassTarget(u);
                              setNewPassValue('');
                              setPassError(null);
                            }}
                            title={`Change password for ${u.name}`}
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Pass
                          </Button>
                          <Button
                            variant="secondary"
                            className="!py-1 !px-2 text-xs"
                            loading={downloadingPdfId === u.id}
                            onClick={() => void handleDownloadPdf(u.id, u.name)}
                            title="Download User Ledger PDF"
                          >
                            <FileDown className="h-3.5 w-3.5" /> PDF
                          </Button>
                          <Link
                            to={`/accounts/${u.id}`}
                            className="text-xs font-medium text-indigo-700 hover:underline px-1.5 py-1"
                          >
                            Ledger →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
