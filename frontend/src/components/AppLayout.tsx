import { Suspense, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BookUser,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { useMe } from '../lib/auth';
import { api } from '../lib/api';
import { useSettings } from '../lib/queries';
import { Badge, ButtonLink } from './ui';
import { PageSkeleton } from './PageSkeleton';

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: 'Users & Ledgers', icon: BookUser, end: false },
  { to: '/transactions', label: 'All Entries', icon: ArrowRightLeft, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

const USER_NAV = [
  { to: '/', label: 'My Deposit & Withdraw', icon: Wallet, end: true },
];

function navClass(isActive: boolean) {
  return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
  }`;
}

export function AppLayout() {
  const me = useMe();
  const settings = useSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const businessName = settings.data?.business.businessName ?? 'Simple Ledger ERP';
  const isAdmin = me.data?.role !== 'USER';
  const navItems = isAdmin ? ADMIN_NAV : USER_NAV;

  // Live Pending Approvals Count in Sidebar for Admin
  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    enabled: isAdmin,
  });
  const pendingCount = dashboardQuery.data?.userLedgerTotals?.pendingSubmissionsCount ?? 0;

  const logout = useMutation({
    mutationFn: () => api.auth.logout(),
    onSettled: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col print:hidden">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">L</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900" title={businessName}>
              {businessName}
            </p>
            <p className="text-xs text-slate-500">{isAdmin ? 'Admin Ledger Panel' : 'User Deposit / Withdraw'}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Main">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {isAdmin && item.to === '/' && pendingCount > 0 ? (
                <span
                  className="ml-auto inline-flex items-center justify-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white"
                  title={`${pendingCount} pending approvals`}
                >
                  {pendingCount}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm text-slate-700">
              <span className="font-medium">{me.data?.name ?? me.data?.username ?? '…'}</span>
            </p>
            <Badge tone={isAdmin ? 'indigo' : 'emerald'}>{isAdmin ? 'Admin' : 'User'}</Badge>
          </div>
          <p className="truncate text-xs text-slate-500">Login: {me.data?.username ?? ''}</p>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="mt-2.5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Top bar (mobile shows menu; desktop shows quick action) */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-md p-2 text-slate-700 hover:bg-slate-100"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <span className="truncate text-sm font-semibold text-slate-900">{businessName}</span>
              {isAdmin && pendingCount > 0 ? (
                <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  {pendingCount} Pending
                </span>
              ) : null}
            </div>
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2">
              {isAdmin && (
                <>
                  <ButtonLink to="/accounts/new" variant="secondary" className="!px-3 !py-1.5">
                    <UserPlus className="h-4 w-4" aria-hidden="true" />{' '}
                    <span className="hidden sm:inline">Create User</span>
                    <span className="sm:hidden">User</span>
                  </ButtonLink>
                  <ButtonLink to="/transactions/new" variant="primary" className="!px-3 !py-1.5">
                    <Plus className="h-4 w-4" aria-hidden="true" />{' '}
                    <span className="hidden sm:inline">Deposit / Withdraw</span>
                    <span className="sm:hidden">Entry</span>
                  </ButtonLink>
                </>
              )}
              <button
                type="button"
                onClick={() => logout.mutate()}
                className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="Sign out"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
          {menuOpen && (
            <nav className="space-y-1 border-t border-slate-200 bg-white p-3 lg:hidden" aria-label="Main mobile">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => navClass(isActive)}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  <span>{item.label}</span>
                  {isAdmin && item.to === '/' && pendingCount > 0 ? (
                    <span className="ml-auto inline-flex items-center justify-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                      {pendingCount}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          )}
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
