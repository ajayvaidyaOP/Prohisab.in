import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatAmount, formatDate, PAYMENT_METHOD_OPTIONS } from '../lib/format';
import { invalidateFinancial, useSettings } from '../lib/queries';
import type { PaymentMethod } from '../lib/types';
import {
  Alert,
  Badge,
  Button,
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

export default function UserPortalPage() {
  const me = useMe();
  const settings = useSettings();
  const queryClient = useQueryClient();

  const accountId = me.data?.accountId;
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const today = settings.data?.today ?? new Date().toISOString().slice(0, 10);
  const entryOptions =
    settings.data?.business.userEntryOptions && settings.data.business.userEntryOptions.length > 0
      ? settings.data.business.userEntryOptions
      : [
          'Cash Deposit',
          'UPI / Bank Deposit',
          'Cash Withdrawal',
          'UPI / Bank Withdrawal',
          'Site Material',
          'Petrol / Transport',
          'Hardware Bill',
          'Office Expense',
        ];

  const [page, setPage] = useState(1);

  // Deposit / Withdrawal Form State
  const [entryKind, setEntryKind] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [selectedOption, setSelectedOption] = useState('');
  const [extraDetail, setExtraDetail] = useState('');
  const [book, setBook] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  const effectiveOption = selectedOption && entryOptions.includes(selectedOption) ? selectedOption : (entryOptions[0] ?? '');

  const ledgerQuery = useQuery({
    queryKey: ['ledger', accountId, { page, pageSize: 25 }],
    queryFn: () => api.ledger.page(accountId!, { page, pageSize: 25 }),
    enabled: Boolean(accountId),
  });

  const booksQuery = useQuery({ queryKey: ['books'], queryFn: () => api.books.list() });

  const addMoneyMutation = useMutation({
    mutationFn: () => {
      const acctType = ledgerQuery.data?.account.type ?? 'CUSTOMER';
      const txType =
        entryKind === 'DEPOSIT'
          ? acctType === 'SUPPLIER'
            ? 'CREDIT_PURCHASE'
            : 'CREDIT_SALE'
          : acctType === 'SUPPLIER'
            ? 'PAYMENT_MADE'
            : 'PAYMENT_RECEIVED';
      const selectedBook = (booksQuery.data ?? []).find((b: any) => b.name === book.trim());
      const parts = [effectiveOption];
      if (book.trim()) parts.push(`Book: ${book.trim()}`);
      if (customerId.trim()) parts.push(`Customer: ${customerId.trim()}`);
      if (bankDetails.trim()) parts.push(`Bank: ${bankDetails.trim()}`);
      if (extraDetail.trim()) parts.push(extraDetail.trim());
      const combinedNotes = parts.join(' — ');
      return api.transactions.create(
        {
          accountId: accountId!,
          bookId: selectedBook ? selectedBook.id : undefined,
          type: txType,
          entryDate,
          amount,
          optionName: effectiveOption,
          detail: extraDetail.trim() || null,
          paymentMethod,
          notes: combinedNotes,
        },
        idempotencyKey,
      );
    },
    onSuccess: (res) => {
      invalidateFinancial(queryClient, accountId!);
      const kindLabel = entryKind === 'DEPOSIT' ? 'Deposit (+)' : 'Withdrawal (-)';
      setSuccessMessage(
        `${kindLabel} of ${formatAmount(res.transaction.amount, symbol)} (${res.transaction.notes}) submitted! Status: Pending Admin Approval.`,
      );
      setAmount('');
      setExtraDetail('');
      setBook('');
      setCustomerId('');
      setBankDetails('');
      setFormError(null);
      setIdempotencyKey(newIdempotencyKey());
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Could not submit entry.');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    if (!amount.trim() || Number(amount) <= 0) {
      setFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!effectiveOption) {
      setFormError('Please select an option configured by the Admin.');
      return;
    }
    addMoneyMutation.mutate();
  };

  if (!accountId) {
    return (
      <ErrorState message="Your login is not linked to a user account. Please ask the Administrator to recreate your user login." />
    );
  }

  if (ledgerQuery.isPending) {
    return (
      <Card padded={false}>
        <SkeletonRows rows={5} cols={4} />
      </Card>
    );
  }

  if (ledgerQuery.isError || !ledgerQuery.data) {
    return (
      <ErrorState
        message={ledgerQuery.error instanceof Error ? ledgerQuery.error.message : 'Could not load your account.'}
        onRetry={() => void ledgerQuery.refetch()}
      />
    );
  }

  const { account, entries, pagination } = ledgerQuery.data;
  const pendingNum = Number(account.pendingBalance);
  const pendingSubCount = account.pendingSubmissionsCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${account.name}`}
        description={`Account Code: ${account.accountCode} · Submit Deposit (+) or Withdrawal (-) by selecting from Admin options`}
      />

      {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}

      {/* 3 Deposit / Withdrawal Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-emerald-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Deposit
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            {formatAmount(account.totalUserPaid, symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Total approved deposits in your account
          </div>
        </Card>

        <Card className="border-l-4 border-l-rose-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Withdrawal
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-rose-700">
            {formatAmount(account.totalAdminPaid, symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Total approved withdrawals / payouts
          </div>
        </Card>

        <Card className="border-l-4 border-l-indigo-600">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Net (Deposit - Withdrawal)
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-indigo-700">
            {formatAmount(account.pendingBalance, symbol)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {pendingNum > 0
              ? 'Available net balance in your account'
              : pendingNum === 0
                ? 'Account is fully settled (₹0.00)'
                : 'Advance / Overdrawn balance'}
          </div>
        </Card>
      </div>

      {pendingSubCount > 0 ? (
        <Alert tone="info">
          You have <strong>{pendingSubCount}</strong> submitted {pendingSubCount === 1 ? 'entry' : 'entries'} totalling{' '}
          <strong>{formatAmount(account.pendingSubmissionsAmount ?? '0.00', symbol)}</strong> awaiting Admin approval.
        </Alert>
      ) : null}

      {/* Add Deposit / Withdrawal Form (Admin Options + Optional Detail/Remark) */}
      <Card
        className={
          entryKind === 'DEPOSIT'
            ? 'border-emerald-300 bg-emerald-50/30'
            : 'border-rose-300 bg-rose-50/30'
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {entryKind === 'DEPOSIT'
                ? '+ Submit New Deposit (Paise Jama / Add)'
                : '- Submit New Withdrawal (Paise Nikalna / Withdraw)'}
            </h2>
            <p className="text-xs text-slate-600">
              Select an option given by the Admin, add an optional remark, and enter the amount.
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
            <button
              type="button"
              onClick={() => {
                setEntryKind('DEPOSIT');
                setIdempotencyKey(newIdempotencyKey());
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                entryKind === 'DEPOSIT'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" /> + Deposit (Add)
            </button>
            <button
              type="button"
              onClick={() => {
                setEntryKind('WITHDRAWAL');
                setIdempotencyKey(newIdempotencyKey());
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                entryKind === 'WITHDRAWAL'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> - Withdrawal (Nikala)
            </button>
          </div>
        </div>

        {formError ? (
          <div className="mt-3">
            <Alert tone="error">{formError}</Alert>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Book">
            {(fid) => (
              <SelectInput
                id={fid}
                value={book}
                onChange={(e) => setBook(e.target.value)}
              >
                <option value="">Select book</option>
                {(booksQuery.data ?? []).filter((b: any) => b.status === 'ACTIVE').map((b: any) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </SelectInput>
            )}
          </Field>

          <Field label="Customer / User ID">
            {(fid) => (
              <TextInput
                id={fid}
                placeholder="e.g. 1721"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                maxLength={60}
              />
            )}
          </Field>

          <Field label="Bank account details">
            {(fid) => (
              <TextInput
                id={fid}
                placeholder="e.g. UPI / Bank details"
                value={bankDetails}
                onChange={(e) => setBankDetails(e.target.value)}
                maxLength={120}
              />
            )}
          </Field>

          <Field label="Select Option (Set by Admin)" required>
            {(fid) => (
              <SelectInput
                id={fid}
                value={effectiveOption}
                onChange={(e) => {
                  setSelectedOption(e.target.value);
                  setIdempotencyKey(newIdempotencyKey());
                }}
              >
                {entryOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>

          <Field label="Detail / Remark (Optional)">
            {(fid) => (
              <TextInput
                id={fid}
                placeholder="e.g. 2 bag cement, ATM, GPay…"
                value={extraDetail}
                onChange={(e) => {
                  setExtraDetail(e.target.value);
                  setIdempotencyKey(newIdempotencyKey());
                }}
                maxLength={120}
              />
            )}
          </Field>

          <Field label={`Amount (${symbol})`} required>
            {(fid) => (
              <TextInput
                id={fid}
                inputMode="decimal"
                placeholder="e.g. 1500"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
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
                value={entryDate}
                onChange={(e) => {
                  setEntryDate(e.target.value);
                  setIdempotencyKey(newIdempotencyKey());
                }}
              />
            )}
          </Field>

          <Field label="Payment Mode">
            {(fid) => (
              <div className="flex gap-2">
                <SelectInput
                  id={fid}
                  value={paymentMethod}
                  onChange={(e) => {
                    setPaymentMethod(e.target.value as PaymentMethod);
                    setIdempotencyKey(newIdempotencyKey());
                  }}
                >
                  {PAYMENT_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </SelectInput>
                <Button
                  type="submit"
                  variant={entryKind === 'DEPOSIT' ? 'primary' : 'danger'}
                  loading={addMoneyMutation.isPending}
                  className="shrink-0"
                >
                  {entryKind === 'DEPOSIT' ? '+ Deposit' : '- Withdraw'}
                </Button>
              </div>
            )}
          </Field>
        </form>
      </Card>

      {/* Only User's Own Entries List */}
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">My Deposit & Withdrawal History</h2>
            <p className="text-xs text-slate-500">
              Only your own Deposit (+) and Withdrawal (-) entries and their approval status are shown here
            </p>
          </div>
          <Badge tone="slate">{pagination.total} entries</Badge>
        </div>

        {entries.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No entries yet"
              description="Use the form above to submit your first Deposit or Withdrawal."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Selected Option & Detail</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {entries.map((row) => {
                  const isDeposit = row.direction === 'INCREASE';
                  const status = row.approvalStatus ?? 'APPROVED';
                  const isPending = status === 'PENDING';
                  const isRejected = status === 'REJECTED';
                  return (
                    <tr
                      key={row.id}
                      className={
                        isRejected
                          ? 'bg-rose-50/30 text-slate-400'
                          : isPending
                            ? 'bg-amber-50/30'
                            : 'hover:bg-slate-50/80'
                      }
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(row.entryDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {isDeposit ? (
                          <Badge tone="emerald">+ Deposit</Badge>
                        ) : (
                          <Badge tone="rose">- Withdrawal</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {row.notes || (isDeposit ? 'Deposit' : 'Withdrawal')}
                        </div>
                        {isRejected && row.rejectionReason ? (
                          <div className="mt-1 text-xs font-medium text-rose-600">
                            Rejected reason: {row.rejectionReason}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {row.paymentMethodLabel || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {isPending ? (
                          <Badge tone="amber">Pending Approval</Badge>
                        ) : isRejected ? (
                          <Badge tone="rose">Rejected</Badge>
                        ) : (
                          <Badge tone="emerald">Approved</Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold">
                        <span
                          className={
                            isRejected
                              ? 'line-through text-slate-400'
                              : isDeposit
                                ? 'text-emerald-700'
                                : 'text-rose-700'
                          }
                        >
                          {isDeposit ? '+' : '-'} {formatAmount(row.amount, symbol)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-slate-200 px-5 py-3">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            onChange={setPage}
          />
        </div>
      </Card>
    </div>
  );
}
