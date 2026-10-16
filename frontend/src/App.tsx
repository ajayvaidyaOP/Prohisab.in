import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { RequireAuth, SessionWatcher, useMe } from './lib/auth';
import { AppLayout } from './components/AppLayout';
import { PageSkeleton } from './components/PageSkeleton';
import { ButtonLink } from './components/ui';

// Secondary screens are loaded on demand so the first load stays small.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const UserPortalPage = lazy(() => import('./pages/UserPortalPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const AccountFormPage = lazy(() => import('./pages/AccountFormPage'));
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage'));
const StatementPage = lazy(() => import('./pages/StatementPage'));
const NewTransactionPage = lazy(() => import('./pages/NewTransactionPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BooksPage = lazy(() => import('./pages/BooksPage'));
const MultiReportPage = lazy(() => import('./pages/MultiReportPage'));

function HomeRouter() {
  const me = useMe();
  if (me.data?.role === 'USER') {
    return <UserPortalPage />;
  }
  return <DashboardPage />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data?.role === 'USER') {
    return <UserPortalPage />;
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl font-semibold text-slate-300">404</p>
      <p className="mt-2 text-lg font-medium text-slate-900">This page does not exist.</p>
      <div className="mt-6">
        <ButtonLink to="/" variant="primary">
          Go to dashboard
        </ButtonLink>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SessionWatcher />
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<PageSkeleton />}>
                <HomeRouter />
              </Suspense>
            }
          />
          <Route path="accounts" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><AccountsPage /></AdminOnly></Suspense>} />
          <Route path="accounts/new" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><AccountFormPage /></AdminOnly></Suspense>} />
          <Route path="accounts/:id" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><AccountDetailPage /></AdminOnly></Suspense>} />
          <Route path="accounts/:id/edit" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><AccountFormPage /></AdminOnly></Suspense>} />
          <Route path="transactions" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><TransactionsPage /></AdminOnly></Suspense>} />
          <Route path="transactions/new" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><NewTransactionPage /></AdminOnly></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><SettingsPage /></AdminOnly></Suspense>} />
          <Route path="books" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><BooksPage /></AdminOnly></Suspense>} />
          <Route path="multi-report" element={<Suspense fallback={<PageSkeleton />}><AdminOnly><MultiReportPage /></AdminOnly></Suspense>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        {/* Printable statement: signed in, but without the app navigation so it prints cleanly. */}
        <Route
          path="accounts/:id/statement"
          element={
            <RequireAuth>
              <Suspense fallback={<PageSkeleton />}>
                <AdminOnly>
                  <StatementPage />
                </AdminOnly>
              </Suspense>
            </RequireAuth>
          }
        />
      </Routes>
    </>
  );
}
