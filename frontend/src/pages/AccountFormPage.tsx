import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { invalidateFinancial, useIdempotentKey } from '../lib/queries';
import { Alert, Button, ButtonLink, Card, Field, PageHeader, Skeleton, TextInput } from '../components/ui';

interface FormState {
  name: string;
  password: string;
  confirmPassword: string;
}

const EMPTY: FormState = {
  name: '',
  password: '',
  confirmPassword: '',
};

const PASSWORD_HINT = 'At least 6 characters, with letters and numbers.';

function isWeakPassword(p: string): boolean {
  return p.length < 6 || !/[a-zA-Z]/.test(p) || !/[0-9]/.test(p);
}

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
  const [showPassword, setShowPassword] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'form' | 'resetForm' | 'resetDone', string>>>({});
  const [loadedId, setLoadedId] = useState<number | null>(null);

  useEffect(() => {
    if (!existing.data || loadedId === existing.data.account.id) return;
    const a = existing.data.account;
    setForm({
      name: a.name,
      password: '',
      confirmPassword: '',
    });
    setLoadedId(a.id);
  }, [existing.data, loadedId]);

  const account = existing.data?.account;

  const reset = useMutation({
    mutationFn: () =>
      api.accounts.resetPassword(accountId, {
        newPassword: form.password,
        confirmPassword: form.confirmPassword,
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, password: '', confirmPassword: '' }));
      setErrors({ resetDone: 'Password reset. The user must sign in with the new password.' });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details?.length) {
        const next: Record<string, string> = {};
        for (const d of error.details) {
          if (d.field && (d.field === 'newPassword' || d.field === 'confirmPassword' || d.field === 'password')) {
            next[d.field] = d.message;
          }
        }
        setErrors(Object.keys(next).length ? next : { resetForm: error.message });
      } else {
        setErrors({ resetForm: error instanceof Error ? error.message : 'Could not reset the password.' });
      }
    },
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) return api.accounts.update(accountId, body);
      return api.accounts.create(body, idempotency.keyFor(body));
    },
    onSuccess: (result) => {
      idempotency.reset();
      invalidateFinancial(qc, result.account.id);
      void qc.invalidateQueries({ queryKey: ['account', result.account.id] });
      void navigate('/accounts', {
        state: {
          flash: editing
            ? `User "${result.account.name}" updated successfully.`
            : `User "${result.account.name}" created! Login Name: ${result.account.name} | Password: ${form.password}`,
        },
      });
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
        setErrors({ form: error instanceof ApiError ? error.message : 'Could not save user. Please try again.' });
      }
    },
  });

  if (editing && existing.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (editing && existing.isError) {
    return <Alert tone="error" title="User not found">{existing.error.message}</Alert>;
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    const cleanName = form.name.trim();
    if (cleanName.length < 2) next.name = 'Enter the user’s name (at least 2 characters).';

    if (!editing) {
      if (!form.password) next.password = `Enter a password for this user. ${PASSWORD_HINT}`;
      else if (isWeakPassword(form.password)) next.password = `Password too weak. ${PASSWORD_HINT}`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (editing) {
      save.mutate({ name: cleanName });
    } else {
      save.mutate({
        name: cleanName,
        password: form.password,
      });
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title={editing ? `Edit User: ${account?.name ?? ''}` : 'Create New User'}
        description={
          editing
            ? 'Update the user’s name or set a new password.'
            : 'Sirf User ka Naam aur Password daalein — user direct create ho jayega.'
        }
        actions={<ButtonLink to="/accounts">Cancel</ButtonLink>}
      />

      <Card>
        <form className="space-y-5" onSubmit={submit} noValidate>
          {errors.form && <Alert tone="error">{errors.form}</Alert>}

          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <UserPlus className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">User Name & Password</h2>
          </div>

          <Field label="User Name (Naam)" required error={errors.name}>
            {(fid, describedBy) => (
              <TextInput
                id={fid}
                placeholder="e.g. Rahul"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={150}
                invalid={!!errors.name}
                aria-describedby={describedBy}
                autoFocus
              />
            )}
          </Field>

          {!editing && (
          <Field
            label={'Password'}
            required
            error={errors.password}
            hint={PASSWORD_HINT}
          >
            {(fid, describedBy) => (
              <div className="relative">
                <TextInput
                  id={fid}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="e.g. rahul123"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  maxLength={200}
                  invalid={!!errors.password}
                  aria-describedby={describedBy}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <ButtonLink to="/accounts">Cancel</ButtonLink>
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Save Changes' : 'Create User'}
            </Button>
          </div>
        </form>
      </Card>

      {editing && (
        <Card>
          <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
            <UserPlus className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">Reset password</h2>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            Users cannot change their own password. As the Administrator, set a new one here — it takes effect on their next sign-in and signs them out everywhere.
          </p>
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const next: Record<string, string> = {};
              if (!form.password) next.password = `Enter a new password. ${PASSWORD_HINT}`;
              else if (isWeakPassword(form.password)) next.password = `Password too weak. ${PASSWORD_HINT}`;
              if (form.confirmPassword !== form.password) next.confirmPassword = 'The passwords do not match.';
              setErrors(next);
              if (Object.keys(next).length === 0) reset.mutate();
            }}
          >
            {errors.resetForm && <Alert tone="error">{errors.resetForm}</Alert>}
            {errors.resetDone && <Alert tone="success">{errors.resetDone}</Alert>}
            <Field label="New password" required error={errors.password} hint={PASSWORD_HINT}>
              {(fid, describedBy) => (
                <TextInput
                  id={fid}
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  invalid={!!errors.password}
                  aria-describedby={describedBy}
                  autoComplete="new-password"
                />
              )}
            </Field>
            <Field label="Confirm new password" required error={errors.confirmPassword}>
              {(fid, describedBy) => (
                <TextInput
                  id={fid}
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => set('confirmPassword', e.target.value)}
                  invalid={!!errors.confirmPassword}
                  aria-describedby={describedBy}
                  autoComplete="new-password"
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="danger" loading={reset.isPending}>
                Reset password
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
