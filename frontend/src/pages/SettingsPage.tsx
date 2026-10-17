import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useSettings } from '../lib/queries';
import type { SettingsView } from '../lib/types';
import { Alert, Button, Card, ErrorState, Field, PageHeader, Skeleton, TextInput } from '../components/ui';

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useSettings();

  if (settings.isPending) {
    return <div className="space-y-6" role="status" aria-label="Loading settings">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48" />
      <Skeleton className="h-80" />
    </div>;
  }
  if (settings.isError) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <CompanyForm initial={settings.data.business} onSaved={(result) => {
        qc.setQueryData<SettingsView>(['settings'], (current) => current ? { ...current, ...result } : current);
        void qc.invalidateQueries({ queryKey: ['settings'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      }} />
      <PasswordForm />
    </div>
  );
}

function CompanyForm({ initial, onSaved }: {
  initial: SettingsView['business'];
  onSaved: (result: { business: SettingsView['business']; today: string }) => void;
}) {
  const [name, setName] = useState(initial.businessName);
  const [logo, setLogo] = useState(initial.logoUrl ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.settings.update({
      businessName: name.trim(), logoUrl: logo.trim() || null,
      // The API requires these fields. Preserve existing values rather than resetting hidden settings.
      businessAddress: initial.businessAddress, businessPhone: initial.businessPhone,
      businessEmail: initial.businessEmail, currencySymbol: initial.currencySymbol, timezone: initial.timezone,
    }),
    onSuccess: (result) => {
      setErrors({});
      setSaved(true);
      setName(result.business.businessName);
      setLogo(result.business.logoUrl ?? '');
      onSaved(result);
    },
    onError: (error) => {
      setSaved(false);
      const details = error instanceof ApiError ? error.details?.filter((detail) => detail.field) : undefined;
      setErrors(details?.length ? Object.fromEntries(details.map((detail) => [detail.field!, detail.message]))
        : { form: error instanceof Error ? error.message : 'Could not save settings.' });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.businessName = 'Enter a company name with at least 2 characters.';
    if (logo.trim()) {
      try {
        const url = new URL(logo.trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid protocol');
      } catch { next.logoUrl = 'Enter a valid HTTP or HTTPS logo URL.'; }
    }
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  return <Card>
    <form onSubmit={submit} noValidate aria-label="Company settings">
      <fieldset disabled={save.isPending} className="space-y-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        {saved && <Alert tone="success">Settings saved.</Alert>}
        <Field label="Company name" error={errors.businessName}>
          {(id, describedBy) => <TextInput id={id} value={name} maxLength={150} autoComplete="organization"
            aria-describedby={describedBy} invalid={!!errors.businessName}
            onChange={(event) => { setName(event.target.value); setSaved(false); setErrors({}); }} />}
        </Field>
        <Field label="Logo URL" error={errors.logoUrl}>
          {(id, describedBy) => <TextInput id={id} type="url" value={logo} maxLength={500} placeholder="https://example.com/logo.png"
            aria-describedby={describedBy} invalid={!!errors.logoUrl}
            onChange={(event) => { setLogo(event.target.value); setSaved(false); setErrors({}); }} />}
        </Field>
        <Button type="submit" loading={save.isPending}>Save</Button>
      </fieldset>
    </form>
  </Card>;
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
    onSuccess: () => {
      setError(null); setSaved(true); setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (err) => {
      setSaved(false);
      setError(err instanceof Error ? err.message : 'Could not change password.');
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!current || !next || !confirm) { setError('All password fields are required.'); return; }
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    if (next.length < 6 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      setError('Use at least 6 characters with letters and numbers.');
      return;
    }
    save.mutate();
  };
  const edited = () => { setError(null); setSaved(false); };
  return <Card>
    <h2 className="mb-2 text-base font-semibold text-slate-900">Change Admin Password</h2>
    <p className="mb-4 text-xs text-slate-500">For security, the database stores a one-way password hash. Enter your current password to set a new one.</p>
    <form onSubmit={submit} noValidate aria-label="Change admin password">
      <fieldset disabled={save.isPending} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Password changed.</Alert>}
        <Field label="Current Password">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={current}
            onChange={(event) => { setCurrent(event.target.value); edited(); }} />}
        </Field>
        <Field label="New Password">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={next}
            onChange={(event) => { setNext(event.target.value); edited(); }} />}
        </Field>
        <Field label="Confirm New Password">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={confirm}
            onChange={(event) => { setConfirm(event.target.value); edited(); }} />}
        </Field>
        <Button type="submit" loading={save.isPending}>Change Password</Button>
      </fieldset>
    </form>
  </Card>;
}
