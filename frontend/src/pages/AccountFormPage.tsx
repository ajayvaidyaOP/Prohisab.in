import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { cleanAmountInput } from '../lib/format';
import { invalidateFinancial, useIdempotentKey } from '../lib/queries';
import type { AccountType } from '../lib/types';
import { Alert, Button, ButtonLink, Card, Field, PageHeader, SelectInput, Skeleton, TextArea, TextInput } from '../components/ui';

interface FormState {
  name: string;
  type: AccountType;
  phone: string;
  email: string;
  address: string;
  openingBalance: string;
  notes: string;
}

const EMPTY: FormState = { name: '', type: 'CUSTOMER', phone: '', email: '', address: '', openingBalance: '', notes: '' };

export default function AccountFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const accountId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const idempotency = useIdempotentKey();

  const existing = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => api.accounts.get(accountId),
    enabled: editing,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'form', string>>>({});
  const [loadedId, setLoadedId] = useState<number | null>(null);

  useEffect(() => {
    if (!existing.data || loadedId === existing.data.account.id) return;
    const a = existing.data.account;
    setForm({
      name: a.name,
      type: a.type,
      phone: a.phone ?? '',
      email: a.email ?? '',
      address: a.address ?? '',
      openingBalance: a.openingBalance,
      notes: a.notes ?? '',
    });
    setLoadedId(a.id);
  }, [existing.data, loadedId]);

  const account = existing.data?.account;
  const locked = !!account && account.entryCount > 0;

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) return api.accounts.update(accountId, body);
      return api.accounts.create(body, idempotency.keyFor(body));
    },
    onSuccess: (result) => {
      idempotency.reset();
      invalidateFinancial(qc, result.account.id);
      void qc.invalidateQueries({ queryKey: ['account', result.account.id] });
      void navigate(`/accounts/${result.account.id}`, { state: { flash: editing ? 'Account updated.' : 'Account created.' } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        const next: typeof errors = {};
        for (const d of error.details) {
          if (d.field && d.field in EMPTY) next[d.field as keyof FormState] = d.message;
        }
        setErrors(next);
        if (Object.keys(next).length === 0) setErrors({ form: error.message });
      } else {
        setErrors({ form: error instanceof ApiError ? error.message : 'Could not save the account. Please try again.' });
      }
    },
  });

  if (editing && existing.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (editing && existing.isError) {
    return <Alert tone="error" title="Account not found">{existing.error.message}</Alert>;
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = 'Enter the name (at least 2 characters).';
    let opening: string | null = null;
    if (!(editing && locked)) {
      opening = cleanAmountInput(form.openingBalance || '0');
      if (opening === null) next.openingBalance = 'Enter an amount with up to 2 decimals, for example 2500 or 2500.50.';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (!(editing && locked)) {
      body.type = form.type;
      body.openingBalance = opening;
    }
    if (editing) {
      // Only send changed fields so unchanged values are not rewritten.
      const original = account!;
      const changed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        const before = (original as unknown as Record<string, unknown>)[key];
        if ((before ?? null) !== (value ?? null)) changed[key] = value;
      }
      if (Object.keys(changed).length === 0) {
        void navigate(`/accounts/${accountId}`);
        return;
      }
      save.mutate(changed);
    } else {
      save.mutate(body);
    }
  };

  const typeHint =
    form.type === 'CUSTOMER'
      ? 'Customers owe you money. Their opening balance is a receivable.'
      : 'Suppliers are people you owe money to. Their opening balance is a payable.';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={editing ? `Edit ${account?.name ?? 'account'}` : 'New account'}
        description={editing ? 'Account code is assigned automatically and cannot be changed.' : 'Add a customer or supplier. The account code is assigned automatically.'}
        actions={<ButtonLink to={editing ? `/accounts/${accountId}` : '/accounts'}>Cancel</ButtonLink>}
      />

      {locked && (
        <Alert tone="warning" title="This account already has transactions">
          The type and opening balance are locked so the history stays accurate. You can still change the name, contact details and notes. To correct a balance, post an adjustment transaction.
        </Alert>
      )}

      <Card>
        <form className="space-y-6" onSubmit={submit} noValidate>
          {errors.form && <Alert tone="error">{errors.form}</Alert>}

          <fieldset className="space-y-2" disabled={locked}>
            <legend className="text-sm font-medium text-slate-700">Account type</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['CUSTOMER', 'SUPPLIER'] as const).map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${form.type === t ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'} ${locked ? 'opacity-70' : ''}`}
                >
                  <input type="radio" name="type" value={t} checked={form.type === t} onChange={() => set('type', t)} className="mt-1 accent-indigo-600" />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{t === 'CUSTOMER' ? 'Customer' : 'Supplier'}</span>
                    <span className="block text-xs text-slate-600">{t === 'CUSTOMER' ? 'Receivable: money they owe you' : 'Payable: money you owe them'}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">{typeHint}</p>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Name" required error={errors.name}>
                {(fid, describedBy) => (
                  <TextInput id={fid} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={150} invalid={!!errors.name} aria-describedby={describedBy} autoFocus={!editing} />
                )}
              </Field>
            </div>
            <Field label="Phone" error={errors.phone} hint="Digits, spaces, + - ( ) only.">
              {(fid, describedBy) => (
                <TextInput id={fid} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} invalid={!!errors.phone} aria-describedby={describedBy} autoComplete="off" />
              )}
            </Field>
            <Field label="Email" error={errors.email}>
              {(fid, describedBy) => (
                <TextInput id={fid} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={190} invalid={!!errors.email} aria-describedby={describedBy} autoComplete="off" />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" error={errors.address}>
                {(fid, describedBy) => (
                  <TextArea id={fid} value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={1000} rows={2} aria-describedby={describedBy} />
                )}
              </Field>
            </div>
            <Field
              label={`Opening balance (${form.type === 'CUSTOMER' ? 'receivable' : 'payable'})`}
              error={errors.openingBalance}
              hint={
                locked
                  ? 'Locked after the first transaction.'
                  : 'Amount owed at the start. Leave as 0 if nothing is owed yet. Shown on the account as a DUE balance.'
              }
            >
              {(fid, describedBy) => (
                <TextInput
                  id={fid}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.openingBalance}
                  onChange={(e) => set('openingBalance', e.target.value)}
                  disabled={locked}
                  invalid={!!errors.openingBalance}
                  aria-describedby={describedBy}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Opening side" hint="Set automatically from the account type.">
              {(fid) => (
                <SelectInput id={fid} value={form.type === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE'} disabled>
                  <option value="RECEIVABLE">Receivable (customer owes you)</option>
                  <option value="PAYABLE">Payable (you owe supplier)</option>
                </SelectInput>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes" error={errors.notes}>
                {(fid, describedBy) => (
                  <TextArea id={fid} value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} rows={3} aria-describedby={describedBy} />
                )}
              </Field>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-6 sm:flex-row sm:justify-end">
            <ButtonLink to={editing ? `/accounts/${accountId}` : '/accounts'}>Cancel</ButtonLink>
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Save changes' : 'Create account'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
