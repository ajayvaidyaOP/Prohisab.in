import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError, SESSION_EXPIRED_EVENT } from './api';

export const ME_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => (await api.auth.me()).user,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Redirects to the login page when there is no valid server-side session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Checking your session">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
    }
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="font-medium text-slate-900">We could not check your sign-in status.</p>
          <p className="mt-1 text-sm text-slate-600">{me.error.message}</p>
          <button className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white" onClick={() => void me.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return children;
}

/** When any request reports an expired session, clear cached data and send the user to sign in again. */
export function SessionWatcher() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    let mounted = true;
    let checking = false;
    const onExpired = () => {
      if (checking) return;
      checking = true;
      // A request started before a successful login can finish with a stale
      // 401 afterwards. Only log out if the CURRENT cookie really has expired.
      void api.auth.me().then(({ user }) => {
        if (mounted) qc.setQueryData(ME_KEY, user);
      }).catch((error: unknown) => {
        if (mounted && error instanceof ApiError && error.status === 401) {
          qc.clear();
          navigate('/login', { replace: true, state: { reason: 'expired' } });
        }
      }).finally(() => { checking = false; });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      mounted = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [qc, navigate]);
  return null;
}
