import { useMemo, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { formatAmount, formatDate, getMonthRange, PAYMENT_METHOD_OPTIONS } from '../lib/format';
import { invalidateFinancial, useSettings } from '../lib/queries';
import type { LedgerEntry, PaymentMethod } from '../lib/types';
import { ReverseDialog } from '../components/ReverseDialog';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonRows,
  TextInput,
} from '../components/ui';

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const accountId = Number(id);
  const location = useLocation();
  const navState = location.state as
    | { flash?: string; savedCredentials?: { name: string; username: string; password: string } }
    | null;

  const queryClient = useQueryClient();
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const today = settings.data?.today ?? new Date().toISOString().slice(0, 10);

  const [flashMessage, setFlashMessage] = useState<string | null>(navState?.flash ?? null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reversing, setReversing] = useState<LedgerEntry | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // Quick Entry / Settlement Form State
  const [quickMode, setQuickMode] = useState<'SETTLE' | 'ADD_PAID'>('SETTLE');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickDate, setQuickDate] = useState(today);
  const [quickMethod, setQuickMethod] = useState<PaymentMethod>('UPI');
  const [quickNotes, setQuickNotes] = useState('');
  const [quickRef, setQuickRef] = useState('');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  // Reject Modal State
  const [rejectTarget, setRejectTarget] = useState<LedgerEntry | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (!ledgerQuery.data) return;
    try {
      setDownloadingPdf(true);
      await api.ledger.downloadPdf(accountId, ledgerQuery.data.account.name, {
        from: from || undefined,
        to: to || undefined,
        search: search.trim() || undefined,
      });
    } catch (err) {
      setFlashMessage(err instanceof ApiError ? err.message : 'Could not download PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const filters = useMemo(
    () => ({ from: from || undefined, to: to || undefined, search: search.trim() || undefined, page, pageSize: 25 }),
    [from, to, search, page],
  );

  const ledgerQuery = useQuery({
    queryKey: ['ledger', accountId, filters],
    queryFn: () => api.ledger.page(accountId, filters),
    enabled: Number.isFinite(accountId),
  });

  const statusMutation = useMutation({
    mutationFn: (isActive: boolean) => api.accounts.setStatus(accountId, isActive),
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId);
      setFlashMessage(res.account.isActive ? 'User reactivated.' : 'User deactivated.');
      setConfirmDeactivate(false);
    },
    onError: (err) => setFlashMessage(err instanceof Error ? err.message : 'Could not update status.'),
  });

  const quickEntryMutation = useMutation({
    mutationFn: () => {
      const acctType = ledgerQuery.data?.account.type ?? 'CUSTOMER';
      const txType =
        quickMode === 'SETTLE'
          ? acctType === 'SUPPLIER'
            ? 'PAYMENT_MADE'
            : 'PAYMENT_RECEIVED'
          : acctType === 'SUPPLIER'
            ? 'CREDIT_PURCHASE'
            : 'CREDIT_SALE';
      return api.transactions.create(
        {
          accountId,
          type: txType,
          entryDate: quickDate,
          amount: quickAmount,
          paymentMethod: quickMethod,
          referenceNumber: quickRef.trim() || null,
          notes:
            quickNotes.trim() ||
            (quickMode === 'SETTLE' ? 'Settlement recorded by Admin' : 'Confirmed credit entry added by Admin'),
        },
        idempotencyKey,
      );
    },
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId);
      setFlashMessage(
        quickMode === 'SETTLE'
          ? `Recorded ${formatAmount(res.transaction.amount, symbol)} settlement.`
          : `Added ${formatAmount(res.transaction.amount, symbol)} confirmed credit entry.`,
      );
      setQuickAmount('');
      setQuickNotes('');
      setQuickRef('');
      setQuickError(null);
      setIdempotencyKey(newIdempotencyKey());
    },
    onError: (err) => {
      setQuickError(err instanceof ApiError ? err.message : 'Could not save entry.');
    },
  });

  const approveMutation = useMutation({
    mutationFn: (entryId: number) => api.transactions.approve(entryId, newIdempotencyKey()),
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId);
      setFlashMessage(
        `Approved entry #${res.transaction.id} (${formatAmount(res.transaction.amount, symbol)}).`,
      );
    },
    onError: (err) => {
      setFlashMessage(err instanceof ApiError ? err.message : 'Could not approve entry.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      api.transactions.reject(rejectTarget!.id, { reason: rejectReason.trim() }, newIdempotencyKey()),
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId);
      setFlashMessage(`Rejected entry #${res.transaction.id}.`);
      setRejectTarget(null);
      setRejectReason('');
      setRejectError(null);
    },
    onError: (err) => {
      setRejectError(err instanceof ApiError ? err.message : 'Could not reject entry.');
    },
  });

  const onQuickSubmit = (e: FormEvent) => {
    e.preventDefault();
    setQuickError(null);
    if (!quickAmount.trim() || Number(quickAmount) <= 0) {
      setQuickError('Enter a valid amount greater than 0.');
      return;
    }
    quickEntryMutation.mutate();
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

  if (ledgerQuery.isPending) {
    return (
      <Card padded={false}>
        <SkeletonRows rows={6} cols={5} />
      </Card>
    );
  }
  if (ledgerQuery.isError || !ledgerQuery.data) {
    return (
      <ErrorState
        message={ledgerQuery.error instanceof Error ? ledgerQuery.error.message : 'Could not load user ledger.'}
        onRetry={() => void ledgerQuery.refetch()}
      />
    );
  }

  const { account, entries, pagination } = ledgerQuery.data;
  const statementSearch = new URLSearchParams();
  if (from) statementSearch.set('from', from);
  if (to) statementSearch.set('to', to);
  if (search.trim()) statementSearch.set('search', search.trim());
  const pendingNum = Number(account.pendingBalance);
  const pendingSubCount = account.pendingSubmissionsCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.name}
        description={`${account.accountCode} · ${account.username ? `Login: @${account.username}` : 'No login username set'}${
          account.phone ? ` · ${account.phone}` : ''
        }`}
        actions={
          <>
            <Button variant="primary" loading={downloadingPdf} onClick={() => void handleDownloadPdf()}>
              Download Ledger PDF
            </Button>
            <ButtonLink to={`/accounts/${account.id}/statement?${statementSearch.toString()}`} variant="secondary">
              Print View
            </ButtonLink>
            <ButtonLink to={`/accounts/${account.id}/edit`} variant="secondary">
              Edit User / Password
            </ButtonLink>
            {account.isActive ? (
              <Button variant="ghost" onClick={() => setConfirmDeactivate(true)}>
                Deactivate
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => statusMutation.mutate(true)}>
                Reactivate
              </Button>
            )}
          </>
        }
      />

      {flashMessage ? <Alert tone="success">{flashMessage}</Alert> : null}

      {navState?.savedCredentials ? (
        <Card className="border-2 border-indigo-500 bg-indigo-50/40">
          <h2 className="text-sm font-semibold text-slate-900">
            Login Credentials for {navState.savedCredentials.name}
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Share this username and password with the user so they can sign in and view/submit entries:
          </p>
          <div className="mt-2 inline-flex flex-wrap items-center gap-4 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-mono">
            <span>
              Username: <strong>{navState.savedCredentials.username}</strong>
            </span>
            <span>
              Password: <strong>{navState.savedCredentials.password}</strong>
            </span>
          </div>
        </Card>
      ) : null}

      {!account.isActive ? (
        <Alert tone="warning">
          This user is inactive. Their login and past transactions are preserved, and new transactions are blocked until you reactivate them.
        </Alert>
      ) : null}

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-emerald-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Deposit (+ Approved)</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            + {formatAmount(account.totalUserPaid, symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Total approved deposits in this user’s ledger</div>
        </Card>

        <Card className="border-l-4 border-l-rose-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Withdrawal (- Approved)</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-rose-700">
            - {formatAmount(account.totalAdminPaid, symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Total approved withdrawals / payouts</div>
        </Card>

        <Card className="border-l-4 border-l-indigo-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net Balance (Deposit - Withdraw)</div>
          <div
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
              pendingNum > 0 ? 'text-indigo-700' : pendingNum < 0 ? 'text-rose-700' : 'text-slate-700'
            }`}
          >
            {formatAmount(account.pendingBalance, symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {pendingNum > 0
              ? 'Available net balance (Deposit − Withdrawal)'
              : pendingNum === 0
                ? 'All settled — zero balance'
                : 'Advance / Overdrawn balance'}
          </div>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending Review</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-amber-700">
            {formatAmount(account.pendingSubmissionsAmount ?? '0.00', symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {pendingSubCount === 0
              ? 'No Deposit/Withdrawal requests waiting'
              : `${pendingSubCount} submitted ${pendingSubCount === 1 ? 'entry' : 'entries'} awaiting review`}
          </div>
        </Card>
      </div>

      {/* Quick Admin Deposit / Withdrawal Card */}
      {account.isActive ? (
        <Card className="border-slate-300 bg-slate-50/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuickMode('ADD_PAID');
                  setQuickAmount('');
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  quickMode === 'ADD_PAID'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                }`}
              >
                + Record Deposit (Add)
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickMode('SETTLE');
                  if (pendingNum > 0 && !quickAmount) setQuickAmount(account.pendingBalance);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  quickMode === 'SETTLE'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                }`}
              >
                - Record Withdrawal / Payout (Deduct)
              </button>
            </div>
            {quickMode === 'SETTLE' && pendingNum > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setQuickAmount(account.pendingBalance);
                  setIdempotencyKey(newIdempotencyKey());
                }}
                className="text-xs font-medium text-rose-700 hover:underline"
              >
                Fill full balance ({formatAmount(account.pendingBalance, symbol)})
              </button>
            ) : null}
          </div>

          {quickError ? (
            <div className="mt-3">
              <Alert tone="error">{quickError}</Alert>
            </div>
          ) : null}

          <form onSubmit={onQuickSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={quickMode === 'SETTLE' ? 'Withdrawal Amount' : 'Deposit Amount'} required>
              {(fid) => (
                <TextInput
                  id={fid}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={quickAmount}
                  onChange={(e) => {
                    setQuickAmount(e.target.value);
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
                  max={today}
                  value={quickDate}
                  onChange={(e) => {
                    setQuickDate(e.target.value);
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                />
              )}
            </Field>
            <Field label="Payment Mode">
              {(fid) => (
                <SelectInput
                  id={fid}
                  value={quickMethod}
                  onChange={(e) => {
                    setQuickMethod(e.target.value as PaymentMethod);
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
                  placeholder={quickMode === 'SETTLE' ? 'e.g. Cash Withdrawal / UPI Payout' : 'e.g. Cash Deposit / Site Material'}
                  value={quickNotes}
                  onChange={(e) => {
                    setQuickNotes(e.target.value);
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                />
              )}
            </Field>
            <Field label="Ref / UTR No.">
              {(fid) => (
                <div className="flex gap-2">
                  <TextInput
                    id={fid}
                    placeholder="Optional"
                    value={quickRef}
                    onChange={(e) => {
                      setQuickRef(e.target.value);
                      setIdempotencyKey(newIdempotencyKey());
                    }}
                  />
                  <Button
                    type="submit"
                    variant={quickMode === 'ADD_PAID' ? 'primary' : 'danger'}
                    loading={quickEntryMutation.isPending}
                    className="shrink-0"
                  >
                    {quickMode === 'SETTLE' ? '- Withdraw' : '+ Deposit'}
                  </Button>
                </div>
              )}
            </Field>
          </form>
        </Card>
      ) : null}

      {/* Reject Modal */}
      {rejectTarget ? (
        <Card className="border-2 border-rose-500 bg-rose-50/40">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Reject Entry #{rejectTarget.id} ({formatAmount(rejectTarget.amount, symbol)})
              </h2>
              <p className="text-xs text-slate-600">
                Provide a reason so {account.name} can see why this entry was rejected.
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
              <Field label="Rejection Reason" required>
                {(fid) => (
                  <TextInput
                    id={fid}
                    placeholder="e.g. Incorrect bill amount / Duplicate submission"
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

      {/* Filters + 1-Click Month Filter Buttons */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Filter:</span>
            <button
              type="button"
              onClick={() => {
                setFrom('');
                setTo('');
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                !from && !to ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Time
            </button>
            <button
              type="button"
              onClick={() => {
                const r = getMonthRange(today, 0);
                setFrom(r.from);
                setTo(r.to);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                from === getMonthRange(today, 0).from ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              This Month ({getMonthRange(today, 0).label})
            </button>
            <button
              type="button"
              onClick={() => {
                const r = getMonthRange(today, -1);
                setFrom(r.from);
                setTo(r.to);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                from === getMonthRange(today, -1).from ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Last Month ({getMonthRange(today, -1).label})
            </button>
          </div>
          <Button variant="secondary" className="!py-1 !px-3 text-xs" loading={downloadingPdf} onClick={() => void handleDownloadPdf()}>
            Download PDF ({from || to ? `${from || 'Start'} to ${to || today}` : 'Full Ledger'})
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="From date">
            {(fid) => (
              <TextInput
                id={fid}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <Field label="To date">
            {(fid) => (
              <TextInput
                id={fid}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <Field label="Search option or remark">
            {(fid) => (
              <TextInput
                id={fid}
                placeholder="Option, remark, UPI ref…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <div className="flex items-end">
            {from || to || search ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setFrom('');
                  setTo('');
                  setSearch('');
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Ledger Entries Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          <span>
            Showing entries in <strong>chronological order (oldest first)</strong> so the running balance reads top-to-bottom.
          </span>
          <span>
            Net Balance: <strong className="font-mono">{formatAmount(account.pendingBalance, symbol)}</strong>
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No ledger entries yet"
              description="Use the form above to record a Deposit (+) or Withdrawal (-)."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Option / Remark</th>
                    <th className="px-4 py-3 text-right">Deposit (+)</th>
                    <th className="px-4 py-3 text-right">Withdraw (−)</th>
                    <th className="px-4 py-3 text-right">Net Balance</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {entries.map((e) => {
                    const status = e.approvalStatus ?? 'APPROVED';
                    return (
                      <tr
                        key={e.id}
                        className={
                          e.isReversed || status === 'REJECTED'
                            ? 'bg-slate-50 text-slate-400'
                            : status === 'PENDING'
                              ? 'bg-amber-50/30'
                              : 'hover:bg-slate-50/60'
                        }
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(e.entryDate)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {e.isReversal ? (
                              <Badge tone="slate">Reversal</Badge>
                            ) : e.direction === 'INCREASE' ? (
                              <Badge tone="indigo">Credit (+)</Badge>
                            ) : (
                              <Badge tone="emerald">Settled (−)</Badge>
                            )}
                            <span className="text-xs text-slate-400">#{e.id}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {e.isReversed ? (
                            <Badge tone="slate">Reversed by #{e.reversedById}</Badge>
                          ) : status === 'PENDING' ? (
                            <Badge tone="amber">Pending Approval</Badge>
                          ) : status === 'REJECTED' ? (
                            <div>
                              <Badge tone="rose">Rejected</Badge>
                              {e.rejectionReason ? (
                                <div className="mt-1 text-xs text-rose-600">Reason: {e.rejectionReason}</div>
                              ) : null}
                            </div>
                          ) : (
                            <Badge tone="emerald">Approved</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>{e.notes || e.description}</div>
                          <div className="text-xs text-slate-400">
                            {e.paymentMethodLabel ? `${e.paymentMethodLabel}` : ''}
                            {e.referenceNumber ? ` · Ref: ${e.referenceNumber}` : ''}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-indigo-700">
                          {e.direction === 'INCREASE' ? `+ ${formatAmount(e.amount, symbol)}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-emerald-700">
                          {e.direction === 'DECREASE' ? `− ${formatAmount(e.amount, symbol)}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold text-slate-900">
                          {formatAmount(e.runningBalance, symbol)}
                          {status !== 'APPROVED' ? (
                            <div className="text-[11px] font-normal text-slate-400">
                              {status === 'PENDING' ? 'Awaiting approval' : 'Not counted'}
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {status === 'PENDING' ? (
                            <div className="inline-flex items-center gap-1.5">
                              <Button
                                className="!py-1 !px-2 text-xs"
                                loading={approveMutation.isPending}
                                onClick={() => approveMutation.mutate(e.id)}
                              >
                                ✓ Approve
                              </Button>
                              <Button
                                variant="danger"
                                className="!py-1 !px-2 text-xs"
                                onClick={() => {
                                  setRejectTarget(e);
                                  setRejectReason('');
                                  setRejectError(null);
                                }}
                              >
                                ✕ Reject
                              </Button>
                            </div>
                          ) : !e.isReversal && !e.isReversed && status === 'APPROVED' && account.isActive ? (
                            <button
                              type="button"
                              onClick={() => setReversing(e)}
                              className="text-xs font-medium text-slate-600 hover:text-rose-700"
                            >
                              Reverse
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      <ReverseDialog
        entry={reversing}
        accountId={account.id}
        open={Boolean(reversing)}
        onClose={() => setReversing(null)}
      />

      <Dialog
        open={confirmDeactivate}
        title={`Deactivate ${account.name}?`}
        onClose={() => setConfirmDeactivate(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDeactivate(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={statusMutation.isPending} onClick={() => statusMutation.mutate(false)}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Their ledger history is kept intact, and you can reactivate them at any time. While inactive, they cannot sign in or add new transactions.
        </p>
      </Dialog>
    </div>
  );
}
