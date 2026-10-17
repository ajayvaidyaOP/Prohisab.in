import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BookOpen,
  BookUser,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Plus,
  Settings,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useMe } from '../lib/auth';
import { api } from '../lib/api';
import { useSettings } from '../lib/queries';
import { ButtonLink } from './ui';
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
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuContainer = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);

  useEffect(() => { setMenuOpen(false); }, [location]);
  useEffect(() => {
    if (!menuOpen) return;
    menuPanel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuContainer.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);
  const businessName = settings.data?.business.businessName ?? 'Deposit & Withdrawal CRM';
  const logoUrl = settings.data?.business.logoUrl ?? null;
  const isAdmin = me.data?.role !== 'USER';
  const navItems = isAdmin ? ADMIN_NAV : USER_NAV;

  const logout = useMutation({
    mutationFn: () => api.auth.logout(),
    onSettled: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });


  return (
    <div className="min-h-screen bg-[#eef2ff]">
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-indigo-100 bg-[#eef2ff]/95 px-3 pb-2 pt-2 backdrop-blur print:hidden sm:px-5">
          <div className="mx-auto w-full max-w-7xl">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#15265d] via-[#243f9b] to-[#354fd0] px-3 py-3 text-white shadow-lg shadow-indigo-900/10 sm:px-5">
              {/* The brand is the way home: Dashboard for admins, own ledger for staff. */}
              <Link
                to="/"
                onClick={() => {
                  setMenuOpen(false);
                  window.scrollTo({ top: 0, behavior: 'auto' });
                }}
                aria-label={`${businessName} — go to dashboard`}
                title="Go to dashboard"
                className="group -m-1 flex min-w-0 items-center gap-3 rounded-xl p-1 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <BrandLogo url={logoUrl} name={businessName} />
                <span className="min-w-0">
                  <span className="block truncate text-base font-bold leading-tight group-hover:underline">{businessName}</span>
                  <span className="mt-1 block truncate text-xs text-indigo-100 sm:text-sm">Deposit & Withdrawal CRM</span>
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && (
                  <div className="hidden items-center gap-2 lg:flex">
                    <ButtonLink to="/accounts#create-user" variant="secondary" className="!px-3 !py-1.5"><UserPlus className="h-4 w-4" /> Create User</ButtonLink>
                    <ButtonLink to="/transactions/new" variant="primary" className="!border !border-white/30 !px-3 !py-1.5"><Plus className="h-4 w-4" /> New Entry</ButtonLink>
                  </div>
                )}
                <span className="hidden text-sm font-medium sm:inline">{isAdmin ? 'Admin' : 'Staff'}</span>
                <div ref={menuContainer} className="relative" onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
                }}>
                  <button
                    ref={menuButton}
                    type="button"
                    aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    aria-expanded={menuOpen}
                    aria-controls={menuId}
                    onClick={() => setMenuOpen((open) => !open)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/30 text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {menuOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
                  </button>
                  {menuOpen && (
                    <div ref={menuPanel} id={menuId} className="absolute right-0 top-full z-50 mt-3 max-h-[calc(100dvh-7rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 text-slate-800 shadow-xl shadow-indigo-950/20">
                      <div className="mb-2 border-b border-slate-100 px-3 py-3">
                        <p className="truncate text-sm font-semibold">{me.data?.name ?? me.data?.username}</p>
                        <p className="mt-1 text-xs text-slate-500">{isAdmin ? 'Admin Ledger Panel' : 'Staff account'}</p>
                      </div>
                      <nav aria-label="Header navigation" className="space-y-1">
                        {navItems.map((item) => (
                          <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isActive ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 hover:text-indigo-700'}`}>
                            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span>{item.label}</span>
                          </NavLink>
                        ))}
                        {isAdmin && (
                          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                            <NavLink to="/accounts#create-user" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-indigo-50 hover:text-indigo-700"><UserPlus className="h-4 w-4" aria-hidden="true" /> Create User</NavLink>
                            <NavLink to="/transactions/new" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-indigo-50 hover:text-indigo-700"><Plus className="h-4 w-4" aria-hidden="true" /> New Entry</NavLink>
                          </div>
                        )}
                      </nav>
                      <div className="mt-2 border-t border-slate-200 pt-2">
                        <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                          <LogOut className="h-4 w-4" aria-hidden="true" /> {logout.isPending ? 'Logging out…' : 'Logout'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>


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
