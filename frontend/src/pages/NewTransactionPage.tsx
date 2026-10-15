import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Search } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { PAYMENT_METHOD_OPTIONS, TRANSACTION_TYPE_OPTIONS, TYPE_EFFECT, cleanAmountInput, formatAmount, formatDate, formatPlain } from '../lib/format';
import { invalidateFinancial, useDebouncedValue, useIdempotentKey, useSettings } from '../lib/queries';
import type { AccountType, Transaction } from '../lib/types';
import { Alert, BalanceBadge, Button, ButtonLink, Card, Field, PageHeader, SelectInput, Skeleton, TextArea, TextInput } from '../components/ui';

const ALL_TYPES = [...TRANSACTION_TYPE_OPTIONS.CUSTOMER, ...TRANSACTION_TYPE_OPTIONS.SUPPLIER].map((t) => t.value as string);
const PAYMENT_TYPES = ['PAYMENT_RECEIVED', 'PAYMENT_MADE'];

interface FormValues {
  accountId: string;
  type: string;
  entryDate: string;
  amount: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
}

interface Success {
  transaction: Transaction;
  accountName: string;
  balance: { amount: string; side: string; status: 'DUE' | 'CREDIT' | 'SETTLED' };
  accountId: number;
  accountType: AccountType;
  replayed: boolean;
}

export default function NewTransactionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const today = settings.data?.today ?? '';
  const idempotency = useIdempotentKey();

  const initialAccount = params.get('accountId') ?? '';
  const initialType = params.get('type') ?? '';

  const [values, setValues] = useState<FormValues>({
    accountId: initialAccount,
    type: ALL_TYPES.includes(initialType) ? initialType : '',
    entryDate: '',
    amount: '',
    paymentMethod: '',
    referenceNumber: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues | 'form', string>>>({});
  const [success, setSuccess] = useState<Success | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const accountId = values.accountId ? Number(values.accountId) : null;
  const selected = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => api.accounts.get(accountId!),
    enabled: accountId !== null,
  });
  const options = useQuery({
    queryKey: ['accountOptions', { search: debouncedSearch }],
    queryFn: () => api.accounts.options({ search: debouncedSearch || undefined }),
    placeholderData: keepPreviousData,
  });

  // Default the date to today in the business time zone once settings load.
  useEffect(() => {
    if (today && !values.entryDate) setValues((v) => ({ ...v, entryDate: today }));
  }, [today, values.entryDate]);

  const account = selected.data?.account;
  const accountType: AccountType | null = account?.type ?? null;
  const typeOptions = accountType ? TRANSACTION_TYPE_OPTIONS[accountType] : [];
  const selectedType = typeOptions.find((t) => t.value === values.type);
  const requiresMethod = PAYMENT_TYPES.includes(values.type);

  // Keep the type valid for the chosen account.
  useEffect(() => {
    if (accountType && values.type && !typeOptions.some((t) => t.value === values.type)) {
      setValues((v) => ({ ...v, type: '' }));
    }
  }, [accountType, values.type, typeOptions]);

  const optionList = useMemo(() => {
    const list = options.data?.items ?? [];
    if (account && !list.some((o) => o.id === account.id)) {
      return [{ id: account.id, accountCode: account.accountCode, name: account.name, type: account.type, isActive: account.isActive, balance: account.balance }, ...list];
    }
    return list;
  }, [options.data, account]);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.transactions.create(body, idempotency.keyFor(body)),
    onSuccess: (result) => {
      idempotency.reset();
      invalidateFinancial(qc, result.account.id);
      setSuccess({
        transaction: result.transaction,
        accountName: result.account.name,
        balance: result.account.balance,
        accountId: result.account.id,
        accountType: result.account.type,
        replayed: result.replayed,
      });
      // Keep the account and date for quick follow-up entries; clear the amount and references.
      setValues((v) => ({ ...v, amount: '', referenceNumber: '', notes: '', type: '' }));
      setErrors({});
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        const next: typeof errors = {};
        for (const d of error.details) {
          if (d.field && d.field in values) next[d.field as keyof FormValues] = d.message;
        }
        setErrors(Object.keys(next).length ? next : { form: error.message });
      } else {
        setErrors({ form: error instanceof ApiError ? error.message : 'The transaction could not be saved. Please try again.' });
      }
    },
  });

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
    setSuccess(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!values.accountId) next.accountId = 'Choose an account.';
    if (!values.type) next.type = 'Choose a transaction type.';
    if (!values.entryDate) next.entryDate = 'Choose a date.';
    else if (today && values.entryDate > today) next.entryDate = `The date cannot be in the future (today is ${formatDate(today)}).`;
    const amount = cleanAmountInput(values.amount);
    if (amount === null || !/[1-9]/.test(amount)) next.amount = 'Enter an amount greater than zero, with up to 2 decimals (for example 1500 or 1500.50).';
    if (requiresMethod && !values.paymentMethod) next.paymentMethod = 'Choose how the payment was made.';
    if (account && !account.isActive) next.accountId = 'This account is inactive. Reactivate it before recording transactions.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const body = {
      accountId: Number(values.accountId),
      type: values.type,
      entryDate: values.entryDate,
      amount,
      paymentMethod: values.paymentMethod || null,
      referenceNumber: values.referenceNumber.trim() || null,
      notes: values.notes.trim() || null,
    };
    create.mutate(body);
  };

  const fieldError = (key: keyof FormValues) => errors[key];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Add transaction"
        description="Record a credit sale, a payment, a credit purchase or a supplier payment. Balances are calculated by the server."
        actions={<ButtonLink to="/transactions">All transactions</ButtonLink>}
      />

      {success && (
        <Alert tone="success" title={success.replayed ? 'Already recorded' : 'Transaction recorded'}>
          <p>
            {success.transaction.typeLabel} of {formatAmount(success.transaction.amount, symbol)} for {success.accountName} on {formatDate(success.transaction.entryDate)}.
          </p>
          <p className="mt-1">
            New balance: <span className="font-semibold tabular-nums">{formatAmount(success.balance.amount, symbol)}</span>{' '}
            <BalanceBadge status={success.balance.status} accountType={success.accountType} />
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/accounts/${success.accountId}`} className="font-medium text-emerald-900 underline">
              View ledger
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/" className="font-medium text-emerald-900 underline">
              Dashboard
            </Link>
          </div>
        </Alert>
      )}

      <Card>
        <form className="space-y-6" onSubmit={submit} noValidate>
          {errors.form && <Alert tone="error">{errors.form}</Alert>}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">1. Choose the account</h2>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <Field label="Find account">
                {(id) => (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <TextInput id={id} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" className="pl-9" maxLength={100} />
                  </div>
                )}
              </Field>
              <Field label="Account" required error={fieldError('accountId')}>
                {(id, describedBy) => (
                  <SelectInput id={id} value={values.accountId} onChange={(e) => set('accountId', e.target.value)} invalid={!!fieldError('accountId')} aria-describedby={describedBy}>
                    <option value="">{options.isPending ? 'Loading accounts…' : 'Select an account'}</option>
                    {optionList.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · {o.accountCode}
                        {!o.isActive ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
            </div>
            {options.data && options.data.items.length === 0 && !account && (
              <Alert tone="info">
                No accounts found.{' '}
                <Link to="/accounts/new" className="font-medium underline">
                  Create a customer or supplier first.
                </Link>
              </Alert>
            )}
            {selected.isPending && accountId !== null && <Skeleton className="h-16" />}
            {account && (
              <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{account.name}</p>
                  <p className="text-xs text-slate-600">
                    <span className="font-mono">{account.accountCode}</span> · {account.typeLabel}
                    {!account.isActive && <span className="ml-2 font-medium text-rose-700">Inactive</span>}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-slate-500">Current balance</p>
                  <p className="font-semibold tabular-nums">
                    {formatPlain(account.balance.amount)} <BalanceBadge status={account.balance.status} accountType={account.type} />
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">2. Transaction details</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Type" required error={fieldError('type')} hint={selectedType ? TYPE_EFFECT[values.type] : accountType ? 'Choose what happened.' : 'Choose an account first to see the matching types.'}>
                  {(id, describedBy) => (
                    <SelectInput id={id} value={values.type} onChange={(e) => set('type', e.target.value)} disabled={!accountType} invalid={!!fieldError('type')} aria-describedby={describedBy}>
                      <option value="">{accountType ? 'Select a type' : 'Choose an account first'}</option>
                      {typeOptions.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
              </div>
              <Field label="Date" required error={fieldError('entryDate')} hint={`Today is ${formatDate(today)}. Future dates are not allowed.`}>
                {(id, describedBy) => (
                  <TextInput id={id} type="date" value={values.entryDate} max={today || undefined} onChange={(e) => set('entryDate', e.target.value)} invalid={!!fieldError('entryDate')} aria-describedby={describedBy} />
                )}
              </Field>
              <Field label={`Amount (${symbol})`} required error={fieldError('amount')} hint="Positive, up to 2 decimals. Commas are fine.">
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={values.amount}
                    onChange={(e) => set('amount', e.target.value)}
                    onBlur={() => {
                      const cleaned = cleanAmountInput(values.amount);
                      if (cleaned) setValues((v) => ({ ...v, amount: cleaned }));
                    }}
                    invalid={!!fieldError('amount')}
                    aria-describedby={describedBy}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field label="Payment method" required={requiresMethod} error={fieldError('paymentMethod')} hint={requiresMethod ? 'Required for payments.' : 'Optional. Used for payments.'}>
                {(id, describedBy) => (
                  <SelectInput id={id} value={values.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} invalid={!!fieldError('paymentMethod')} aria-describedby={describedBy}>
                    <option value="">{requiresMethod ? 'Select a method' : 'Not applicable'}</option>
                    {PAYMENT_METHOD_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label="Reference number" error={fieldError('referenceNumber')} hint="Invoice, UPI or bank reference (optional).">
                {(id, describedBy) => (
                  <TextInput id={id} value={values.referenceNumber} onChange={(e) => set('referenceNumber', e.target.value)} maxLength={100} aria-describedby={describedBy} autoComplete="off" />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes" error={fieldError('notes')}>
                  {(id, describedBy) => (
                    <TextArea id={id} value={values.notes} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={500} aria-describedby={describedBy} />
                  )}
                </Field>
              </div>
            </div>
          </section>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Saved once, even if you click twice. Posted entries are never edited; use Reverse to correct one.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate(accountId ? `/accounts/${accountId}` : '/accounts')}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!!account && !account.isActive}>
                Save transaction
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
