import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { ME_KEY, useMe } from '../lib/auth';
import { Alert, Button, Field, TextInput } from '../components/ui';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const expired = (location.state as { reason?: string } | null)?.reason === 'expired';

  const login = useMutation({
    mutationFn: () => api.auth.login(username.trim(), password),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data.user);
      navigate(from.startsWith('/') ? from : '/', { replace: true });
    },
    onError: () => setPassword(''),
  });

  // Already signed in (e.g. after a refresh): go straight to the dashboard.
  if (me.isSuccess) return <Navigate to="/" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!username.trim()) next.username = 'Enter your username.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length === 0) login.mutate();
  };

  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50 to-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">L</span>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Simple Ledger ERP</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in to manage customers, suppliers and balances.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <form className="space-y-5" onSubmit={submit} noValidate>
            {expired && <Alert tone="warning">Your session ended. Please sign in again.</Alert>}
            {error && <Alert tone="error">{error.message}</Alert>}
            <Field label="Username" required error={errors.username}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={!!errors.username}
                  maxLength={64}
                />
              )}
            </Field>
            <Field label="Password" required error={errors.password}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={!!errors.password}
                  maxLength={200}
                />
              )}
            </Field>
            <Button type="submit" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">Accounts are created by the business owner. Public sign-up is disabled.</p>
      </div>
    </div>
  );
}
