import { Suspense, useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BookOpen,
  BookUser,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useMe } from '../lib/auth';
import { api } from '../lib/api';
import { useSettings } from '../lib/queries';
import { Badge, ButtonLink } from './ui';
import { PageSkeleton } from './PageSkeleton';

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Entries', icon: ArrowRightLeft, end: false },
  { to: '/accounts', label: 'Users', icon: BookUser, end: false },
  { to: '/multi-report', label: 'Multi User Report', icon: ArrowRightLeft, end: false },
  { to: '/books', label: 'Books', icon: BookOpen, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
  { to: '/audit', label: 'Audit', icon: ClipboardList, end: false },
];

const USER_NAV = [
  { to: '/', label: 'My Deposit & Withdraw', icon: Wallet, end: true },
];

function navClass(isActive: boolean) {
  return `flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
    isActive ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-700'
  }`;
}

function BrandLogo({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return <img src={url} alt={`${name} logo`} onError={() => setFailed(true)} className="h-11 w-11 shrink-0 rounded-xl border border-white/50 bg-white object-contain p-0.5" />;
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/50 bg-white/15 text-xl font-black text-white">
      {name.trim().charAt(0).toUpperCase() || 'D'}
    </span>
  );
}

export function AppLayout() {
  const me = useMe();
  const settings = useSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const businessName = settings.data?.business.businessName ?? 'Deposit & Withdrawal CRM';
  const logoUrl = settings.data?.business.logoUrl ?? null;
  const isAdmin = me.data?.role !== 'USER';
  const navItems = isAdmin ? ADMIN_NAV : USER_NAV;

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

  const signOutButton = (
    <button
      type="button"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white/95 hover:bg-white/10 disabled:opacity-60"
      aria-label="Sign out"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" /> <span>Logout</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#eef2ff] lg:flex">
      {/* Desktop navigation */}
      <aside className="hidden border-r border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col print:hidden">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <BrandLogo url={logoUrl} name={businessName} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900" title={businessName}>{businessName}</p>
            <p className="text-xs text-slate-500">{isAdmin ? 'Admin Ledger Panel' : 'User Deposit / Withdraw'}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Main">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'}`}>
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {isAdmin && item.to === '/' && pendingCount > 0 ? <span className="ml-auto inline-flex items-center justify-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">{pendingCount}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm text-slate-700"><span className="font-medium">{me.data?.name ?? me.data?.username ?? '…'}</span></p>
            <Badge tone={isAdmin ? 'indigo' : 'emerald'}>{isAdmin ? 'Admin' : 'User'}</Badge>
          </div>
          <p className="truncate text-xs text-slate-500">Login: {me.data?.username ?? ''}</p>
          <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} className="mt-2.5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-60">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-indigo-100 bg-[#eef2ff]/95 px-3 pb-2 pt-2 backdrop-blur print:hidden sm:px-5">
          <div className="mx-auto w-full max-w-7xl">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#15265d] via-[#243f9b] to-[#354fd0] px-3 py-3 text-white shadow-lg shadow-indigo-900/10 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <BrandLogo url={logoUrl} name={businessName} />
                <div className="min-w-0">
                  <p className="truncate text-base font-bold leading-tight">{businessName}</p>
                  <p className="mt-1 truncate text-xs text-indigo-100 sm:text-sm">Deposit & Withdrawal CRM</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && (
                  <div className="hidden items-center gap-2 lg:flex">
                    <ButtonLink to="/accounts/new" variant="secondary" className="!px-3 !py-1.5"><UserPlus className="h-4 w-4" /> Create User</ButtonLink>
                    <ButtonLink to="/transactions/new" variant="primary" className="!border !border-white/30 !px-3 !py-1.5"><Plus className="h-4 w-4" /> New Entry</ButtonLink>
                  </div>
                )}
                {isAdmin && pendingCount > 0 && <span className="hidden rounded-full bg-rose-500 px-2 py-1 text-xs font-bold sm:inline-flex">{pendingCount} Pending</span>}
                <span className="hidden text-sm font-medium sm:inline">{isAdmin ? 'Admin' : 'Staff'}</span>
                {signOutButton}
              </div>
            </div>

            <nav className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Main mobile">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  <span>{item.label}</span>
                  {isAdmin && item.to === '/' && pendingCount > 0 ? <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingCount}</span> : null}
                </NavLink>
              ))}
              {isAdmin && (
                <>
                  <ButtonLink to="/accounts/new" variant="secondary" className="shrink-0 !rounded-xl !px-3 !py-2">
                    <UserPlus className="h-4 w-4" aria-hidden="true" /><span>Create User</span>
                  </ButtonLink>
                  <ButtonLink to="/transactions/new" variant="primary" className="shrink-0 !rounded-xl !px-3 !py-2">
                    <Plus className="h-4 w-4" aria-hidden="true" /><span>New Entry</span>
                  </ButtonLink>
                </>
              )}
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-3 sm:p-5 lg:p-8">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
          <footer className="py-8 text-center text-xs text-slate-500">Secure ledger · {settings.data?.business.timezone ?? 'Asia/Kolkata'}</footer>
        </main>
      </div>
    </div>
  );
}
