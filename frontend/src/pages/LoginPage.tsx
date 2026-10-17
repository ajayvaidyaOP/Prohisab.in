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
  const [mode, setMode] = useState<'admin' | 'staff'>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string; pin?: string }>({});

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  // Only allow an in-app path (a lone '/' or normal path); never a protocol-relative URL.
  const safeFrom = from.startsWith('/') && !from.startsWith('//') ? from : '/';
  const expired = (location.state as { reason?: string } | null)?.reason === 'expired';

  // A 200 login is not enough inside an embedded preview: some browsers discard
  // third-party cookies. Confirm the cookie works before entering protected pages.
  const signInAndConfirm = async (signIn: () => Promise<unknown>) => {
    await signIn();
    try {
      return await api.auth.me();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new ApiError(401, 'SESSION_COOKIE_BLOCKED',
          'Login succeeded, but your browser did not save the session cookie. Open the preview in a new tab and sign in again, or allow third-party cookies.');
      }
      throw error;
    }
  };

  const login = useMutation({
    mutationFn: () => signInAndConfirm(() => api.auth.login(username.trim(), password)),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data.user);
      navigate(safeFrom, { replace: true });
    },
    onError: () => setPassword(''),
  });

  const pinLogin = useMutation({
    mutationFn: () => signInAndConfirm(() => api.auth.pinLogin(pin.trim())),
    onSuccess: (data) => {
      qc.setQueryData(ME_KEY, data.user);
      navigate(safeFrom, { replace: true });
    },
    onError: () => setPin(''),
  });

  if (me.isSuccess) return <Navigate to={safeFrom} replace />;

  const submitAdmin = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!username.trim()) next.username = 'Enter your username.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length === 0) login.mutate();
  };

  const submitPin = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!/^\d{4}$/.test(pin.trim())) next.pin = 'Enter your 4-digit PIN.';
    setErrors(next);
    if (Object.keys(next).length === 0) pinLogin.mutate();
  };

  const error = (mode === 'admin' ? login.error : pinLogin.error) instanceof ApiError
    ? ((mode === 'admin' ? login.error : pinLogin.error) as ApiError)
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50 to-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">L</span>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Deposit &amp; Withdrawal CRM</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in as Admin or Staff to view your ledger and add entries.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-5 inline-flex w-full rounded-lg border border-slate-200 bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode('admin')}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${mode === 'admin' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
            >
              Admin Login
            </button>
            <button
              type="button"
              onClick={() => setMode('staff')}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${mode === 'staff' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
            >
              Staff PIN Login
            </button>
          </div>

          {expired && <Alert tone="warning">Your session ended. Please sign in again.</Alert>}
          {error && <Alert tone="error">{error.message}</Alert>}
          {error?.code === 'SESSION_COOKIE_BLOCKED' && (
            <a href={window.location.href} target="_blank" rel="noopener noreferrer"
              className="mb-4 inline-block text-sm font-medium text-indigo-700 underline">
              Open website in a new tab
            </a>
          )}

          {mode === 'admin' ? (
            <form className="space-y-5" onSubmit={submitAdmin} noValidate>
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
                Login
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={submitPin} noValidate>
              <Field label="4-digit PIN" required error={errors.pin}>
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    autoFocus
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    aria-describedby={describedBy}
                    invalid={!!errors.pin}
                    maxLength={4}
                  />
                )}
              </Field>
              <Button type="submit" className="w-full" loading={pinLogin.isPending}>
                Login
              </Button>
              <p className="text-center text-xs text-slate-500">Your admin provides your PIN and book access.</p>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Users can sign in with the PIN created by the Administrator.
        </p>
      </div>
    </div>
  );
}
