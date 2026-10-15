import { Suspense, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, BookUser, LayoutDashboard, LogOut, Menu, Plus, Settings, X } from 'lucide-react';
import { useMe } from '../lib/auth';
import { api } from '../lib/api';
import { useSettings } from '../lib/queries';
import { ButtonLink } from './ui';
import { PageSkeleton } from './PageSkeleton';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: 'Accounts', icon: BookUser, end: false },
  { to: '/transactions', label: 'Transactions', icon: ArrowRightLeft, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
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
            <p className="text-xs text-slate-500">Simple Ledger ERP</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm text-slate-700">Signed in as <span className="font-medium">{me.data?.username ?? '…'}</span></p>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-60"
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
            </div>
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2">
              <ButtonLink to="/transactions/new" variant="primary" className="!px-3 !py-1.5">
                <Plus className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Add transaction</span><span className="sm:hidden">Add</span>
              </ButtonLink>
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
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)} className={({ isActive }) => navClass(isActive)}>
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
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
