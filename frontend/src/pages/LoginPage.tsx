import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Landmark, ShieldCheck } from 'lucide-react';
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
    <main className="login-page">
      <div className="login-shell">
        <section className="login-art" aria-label="Deposit and withdrawal ledger workspace">
          <div className="login-brand">
            <span className="login-brand-icon"><Landmark className="h-5 w-5" aria-hidden="true" /></span>
            <span>
              <span className="login-brand-name">Prohisab.in</span>
              <span className="login-brand-caption">LEDGER WORKSPACE</span>
            </span>
          </div>

          <div className="login-story-copy">
            <p className="login-overline"><span aria-hidden="true" />A clearer way to keep count</p>
            <h1>Every entry.<br /><em>In its right place.</em></h1>
            <p className="login-story-description">
              Deposits, withdrawals, and the details behind every move — together in one calm, reliable workspace.
            </p>
          </div>

          <div className="login-visual" aria-hidden="true">
            <div className="login-visual-head">
              <span>Ledger overview</span>
              <span className="login-live-badge"><i /> LIVE LEDGER</span>
            </div>
            <div className="login-chart">
              {[34, 48, 41, 67, 54, 78, 60, 88, 68, 96, 73, 84].map((height, index) => (
                <span key={index} className={index % 3 === 1 ? 'login-chart-bar login-chart-bar-soft' : 'login-chart-bar'} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="login-visual-legend">
              <span><i className="login-legend-dot login-legend-dot-deposit" /> Deposits</span>
              <span><i className="login-legend-dot login-legend-dot-withdrawal" /> Withdrawals</span>
            </div>
            <div className="login-visual-footer">
              <span><ShieldCheck className="h-4 w-4" /> Private, reliable records</span>
              <span className="login-visual-arrows"><ArrowDownLeft className="h-4 w-4" /><ArrowUpRight className="h-4 w-4" /></span>
            </div>
          </div>
          <div className="login-art-orb login-art-orb-one" aria-hidden="true" />
          <div className="login-art-orb login-art-orb-two" aria-hidden="true" />
        </section>

        <section className="login-form-panel" aria-labelledby="login-heading">
          <div className="login-form-inner">
            <div className="login-mobile-brand">
              <span className="login-brand-icon"><Landmark className="h-5 w-5" aria-hidden="true" /></span>
              <span className="login-brand-name">Prohisab.in</span>
            </div>
            <div className="login-heading-block">
              <p className="login-eyebrow">ACCOUNT ACCESS</p>
              <h2 id="login-heading">Welcome back</h2>
              <p>Sign in to continue to your ledger.</p>
            </div>

            <div className="login-form-card">
              <div className="login-tabs" aria-label="Choose a sign-in method">
                <button
                  type="button"
                  aria-pressed={mode === 'admin'}
                  onClick={() => setMode('admin')}
                  className={`login-tab ${mode === 'admin' ? 'login-tab-active' : ''}`}
                >
                  Admin Login
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'staff'}
                  onClick={() => setMode('staff')}
                  className={`login-tab ${mode === 'staff' ? 'login-tab-active' : ''}`}
                >
                  Staff PIN Login
                </button>
              </div>

              {expired && <Alert tone="warning">Your session ended. Please sign in again.</Alert>}
              {error && <Alert tone="error">{error.message}</Alert>}
              {error?.code === 'SESSION_COOKIE_BLOCKED' && (
                <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="login-new-tab-link">
                  Open website in a new tab
                </a>
              )}

              {mode === 'admin' ? (
                <form className="login-form space-y-5" onSubmit={submitAdmin} noValidate>
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
                <form className="login-form space-y-5" onSubmit={submitPin} noValidate>
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
                  <p className="login-help-text">Your administrator provides your PIN and book access.</p>
                </form>
              )}
            </div>

            <p className="login-security-note"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Secure, private access for your team</p>
          </div>
        </section>
      </div>
      <p className="login-copyright">PROHISAB.IN <span>·</span> DEPOSITS, WITHDRAWALS, IN BALANCE.</p>
    </main>
  );
}
