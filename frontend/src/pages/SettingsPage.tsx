import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { Alert, Badge, Button, ButtonLink, Card, Field, PageHeader, Pagination, SelectInput, Skeleton, TextArea, TextInput } from '../components/ui';

const TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

const ACTION_LABELS: Record<string, string> = {
  ADMIN_CREATED: 'Administrator created',
  ADMIN_PASSWORD_CHANGED: 'Password changed',
  ADMIN_PASSWORD_RESET_CLI: 'Password reset (command line)',
  ACCOUNT_CREATED: 'Account created',
  ACCOUNT_UPDATED: 'Account updated',
  ACCOUNT_DEACTIVATED: 'Account deactivated',
  ACCOUNT_REACTIVATED: 'Account reactivated',
  USER_CREATED: 'Staff account created',
  USER_UPDATED: 'Staff account updated',
  USER_ACTIVATED: 'Staff account activated',
  USER_DEACTIVATED: 'Staff account deactivated',
  USER_BOOKS_UPDATED: 'Book access changed',
  USER_BACKDATE_UPDATED: 'Back-date permission changed',
  PIN_RESET: 'PIN reset',
  PIN_DISABLED: 'PIN disabled',
  PASSWORD_RESET: 'Password reset',
  BOOK_CREATED: 'Book created',
  BOOK_ARCHIVED: 'Book archived',
  BOOK_RESTORED: 'Book restored',
  LEDGER_ENTRY_CREATED: 'Transaction posted',
  TRANSACTION_CREATED: 'Transaction posted',
  TRANSACTION_APPROVED: 'Transaction approved',
  TRANSACTION_REJECTED: 'Transaction rejected',
  ENTRY_OPTIONS_REPLACED: 'Entry options updated',
  LEDGER_ENTRY_REVERSED: 'Entry reversed',
  TRANSACTION_REVERSED: 'Entry reversed',
  SETTINGS_UPDATED: 'Settings updated',
  AUTH_LOGIN: 'Signed in',
  AUTH_LOGIN_FAILED: 'Failed sign-in attempt',
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const [auditPage, setAuditPage] = useState(1);
  const audit = useQuery({
    queryKey: ['audit', { page: auditPage }],
    queryFn: () => api.audit({ page: auditPage, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  const timezone = settings.data?.business.timezone ?? 'Asia/Kolkata';

  if (settings.isPending) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading settings">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (settings.isError) return <Alert tone="error">{settings.error.message}</Alert>;

  const s = settings.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description={`Signed in as ${s.user.username}. You are signed out automatically after ${s.session.idleTimeoutMinutes} minutes without activity.`} />

      <PasswordForm />

      <div className="grid gap-6 xl:grid-cols-2">
        <BusinessForm
          key={JSON.stringify(s.business)}
          initial={s.business}
          timezones={TIME_ZONES}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['settings'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
        <EntryOptionsForm
          key={(s.business.userEntryOptions ?? []).join('|')}
          initial={s.business.userEntryOptions ?? []}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['settings'] });
          }}
        />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Activity log</h2>
            <p className="text-sm text-slate-600">Who changed what and when. Entries cannot be edited or deleted.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="slate">Time zone: {timezone}</Badge>
            <ButtonLink to="/audit" variant="secondary" className="!px-3 !py-1.5">Open full audit</ButtonLink>
          </div>
        </div>
        {audit.isPending ? (
          <Skeleton className="h-48" />
        ) : audit.isError ? (
          <Alert tone="error">{audit.error.message}</Alert>
        ) : audit.data.items.length === 0 ? (
          <Alert tone="info">No activity recorded yet.</Alert>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-6">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2 sm:px-6">When</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="hidden px-4 py-2 md:table-cell">Record</th>
                  <th className="hidden px-4 py-2 sm:table-cell">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {audit.data.items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600 sm:px-6">{formatDateTime(item.createdAt, timezone)}</td>
                    <td className="px-4 py-2 text-slate-900">
                      {ACTION_LABELS[item.action] ?? item.action}
                      <AuditDetail details={item.details} />
                    </td>
                    <td className="hidden px-4 py-2 text-slate-600 md:table-cell">
                      {item.entityType}
                      {item.entityId ? ` #${item.entityId}` : ''}
                    </td>
                    <td className="hidden px-4 py-2 text-slate-600 sm:table-cell">{item.actor ?? 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {audit.data && (
          <div className="-mx-4 sm:-mx-6">
            <Pagination page={audit.data.pagination.page} totalPages={audit.data.pagination.totalPages} total={audit.data.pagination.total} onChange={setAuditPage} />
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Today for reporting: {formatDate(s.today)}.</p>
      </Card>
    </div>
  );
}

function AuditDetail({ details }: { details: unknown }) {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.accountCode === 'string') parts.push(d.accountCode);
  if (typeof d.name === 'string') parts.push(d.name);
  if (typeof d.amount === 'string') parts.push(`amount ${d.amount}`);
  if (typeof d.reason === 'string') parts.push(`reason: ${d.reason}`);
  if (parts.length === 0) return null;
  return <p className="text-xs text-slate-500">{parts.join(' · ')}</p>;
}


function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
    onSuccess: () => { setError(null); setSaved(true); setCurrent(''); setNext(''); setConfirm(''); },
    onError: (e) => { setSaved(false); setError(e instanceof ApiError ? e.message : 'Could not change password.'); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null); setSaved(false);
    if (!current || !next || !confirm) { setError('All fields are required.'); return; }
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    save.mutate();
  };
  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold text-slate-900">Change Admin Password</h2>
      <p className="mb-4 text-sm text-slate-600">Enter your current password to set a new one.</p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Password changed.</Alert>}
        <Field label="Current Password" required>
          {(id) => <TextInput id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="New Password" required>
          {(id) => <TextInput id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Confirm New Password" required>
          {(id) => <TextInput id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>Change Password</Button>
        </div>
      </form>
    </Card>
  );
}

function BusinessForm({
  initial,
  timezones,
  onSaved,
}: {
  initial: { businessName: string; businessAddress: string | null; businessPhone: string | null; businessEmail: string | null; currencySymbol: string; timezone: string; logoUrl?: string | null };
  timezones: string[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    businessName: initial.businessName,
    businessAddress: initial.businessAddress ?? '',
    businessPhone: initial.businessPhone ?? '',
    businessEmail: initial.businessEmail ?? '',
    currencySymbol: initial.currencySymbol,
    timezone: initial.timezone,
    logoUrl: initial.logoUrl ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const zones = timezones.includes(form.timezone) ? timezones : [form.timezone, ...timezones];

  const save = useMutation({
    mutationFn: () =>
      api.settings.update({
        businessName: form.businessName.trim(),
        businessAddress: form.businessAddress.trim() || null,
        businessPhone: form.businessPhone.trim() || null,
        businessEmail: form.businessEmail.trim() || null,
        currencySymbol: form.currencySymbol.trim(),
        timezone: form.timezone,
        logoUrl: form.logoUrl.trim() || null,
      }),
    onSuccess: () => {
      setErrors({});
      setSaved(true);
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        setErrors(Object.fromEntries(error.details.filter((d) => d.field).map((d) => [d.field as string, d.message])));
      } else {
        setErrors({ form: error.message });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const next: Record<string, string> = {};
    if (form.businessName.trim().length < 2) next.businessName = 'Enter the business name (at least 2 characters).';
    if (!form.currencySymbol.trim()) next.currencySymbol = 'Enter a currency symbol, for example ₹.';
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold text-slate-900">Business profile</h2>
      <p className="mb-4 text-sm text-slate-600">Shown on printed statements. The time zone decides what “today” means for dates and dashboard figures.</p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        {saved && <Alert tone="success">Settings saved.</Alert>}
        <Field label="Business name" required error={errors.businessName}>
          {(id, describedBy) => <TextInput id={id} value={form.businessName} onChange={(e) => set('businessName', e.target.value)} maxLength={150} aria-describedby={describedBy} invalid={!!errors.businessName} />}
        </Field>
        <Field label="Address" error={errors.businessAddress}>
          {(id, describedBy) => <TextArea id={id} rows={2} value={form.businessAddress} onChange={(e) => set('businessAddress', e.target.value)} maxLength={500} aria-describedby={describedBy} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errors.businessPhone}>
            {(id, describedBy) => <TextInput id={id} value={form.businessPhone} onChange={(e) => set('businessPhone', e.target.value)} maxLength={30} aria-describedby={describedBy} />}
          </Field>
          <Field label="Email" error={errors.businessEmail}>
            {(id, describedBy) => <TextInput id={id} type="email" value={form.businessEmail} onChange={(e) => set('businessEmail', e.target.value)} maxLength={190} aria-describedby={describedBy} />}
          </Field>
          <Field label="Logo URL" error={errors.logoUrl} hint="This logo appears in the app header and on this profile preview.">
            {(id, describedBy) => <TextInput id={id} type="url" value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} maxLength={500} aria-describedby={describedBy} placeholder="https://..." />}
          </Field>
          {form.logoUrl.trim() && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <img src={form.logoUrl} alt="Business logo preview" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} className="h-12 w-12 rounded-lg bg-white object-contain p-1" />
              <span className="text-sm text-slate-600">Business logo preview</span>
            </div>
          )}
          <Field label="Currency symbol" required error={errors.currencySymbol}>
            {(id, describedBy) => <TextInput id={id} value={form.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} maxLength={8} aria-describedby={describedBy} invalid={!!errors.currencySymbol} />}
          </Field>
          <Field label="Time zone" required error={errors.timezone} hint="Used for “today”, dashboard totals and the default transaction date.">
            {(id, describedBy) => (
              <SelectInput id={id} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} aria-describedby={describedBy}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EntryOptionsForm({ initial, onSaved }: { initial: string[]; onSaved: () => void }) {
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.settings.updateEntryOptions(items),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      onSaved();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the options.'),
  });

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (items.some((o) => o.toLowerCase() === name.toLowerCase())) {
      setError('That option already exists.');
      return;
    }
    setItems((list) => [...list, name]);
    setDraft('');
    setError(null);
    setSaved(false);
  };

  const remove = (name: string) => {
    setItems((list) => list.filter((o) => o !== name));
    setSaved(false);
  };

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold text-slate-900">Entry options</h2>
      <p className="mb-4 text-sm text-slate-600">
        The list users pick from when they add a deposit or withdrawal. Removing an option keeps it on past entries but hides it from new ones.
      </p>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Entry options saved.</Alert>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No options yet. Add at least one below.</li>}
          {items.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-slate-900">{name}</span>
              <Button type="button" variant="ghost" onClick={() => remove(name)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            aria-label="New entry option"
            placeholder="For example: Site Material"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={add}>
            Add option
          </Button>
        </div>
        <div className="flex justify-end">
          <Button type="button" loading={save.isPending} disabled={items.length === 0} onClick={() => save.mutate()}>
            Save options
          </Button>
        </div>
      </div>
    </Card>
  );
}
