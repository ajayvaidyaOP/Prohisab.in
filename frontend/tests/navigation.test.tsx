import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import App from '../src/App';

const mocks = vi.hoisted(() => ({
  role: 'ADMIN',
  dashboard: vi.fn(), logout: vi.fn(), list: vi.fn(), books: vi.fn(),
  create: vi.fn(), setBooks: vi.fn(), get: vi.fn(),
}));
vi.mock('../src/lib/auth', () => ({
  useMe: () => ({ data: { id: 1, name: 'Test Admin', username: 'admin', role: mocks.role } }),
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
  SessionWatcher: () => null,
}));
vi.mock('../src/lib/queries', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/queries')>(),
  useSettings: () => ({ data: { today: '2026-10-18', business: { businessName: 'Test Business', timezone: 'Asia/Kolkata', currencySymbol: '₹' } } }),
}));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  api: {
    dashboard: mocks.dashboard,
    auth: { logout: mocks.logout },
    books: { list: mocks.books },
    accounts: { list: mocks.list, create: mocks.create, setBooks: mocks.setBooks, get: mocks.get },
  },
}));
vi.mock('../src/pages/DashboardPage', () => ({ default: () => <h1>Dashboard content</h1> }));
vi.mock('../src/pages/LoginPage', () => ({ default: () => <h1>Login screen</h1> }));
vi.mock('../src/pages/UserPortalPage', () => ({ default: () => <h1>Staff portal</h1> }));
vi.mock('../src/pages/BooksPage', () => ({ default: () => <h1>Books content</h1> }));

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.hash}</output>;
}
function renderApp(path = '/accounts') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><App /><CurrentLocation /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = 'ADMIN';
  mocks.dashboard.mockResolvedValue({ userLedgerTotals: { pendingSubmissionsCount: 2 } });
  mocks.logout.mockResolvedValue({});
  mocks.list.mockResolvedValue({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  mocks.books.mockResolvedValue([{ id: 10, name: 'Luxury online', status: 'ACTIVE' }]);
  mocks.create.mockResolvedValue({ account: { id: 2, name: 'New Staff' } });
  mocks.setBooks.mockResolvedValue({});
  mocks.get.mockResolvedValue({ account: { id: 2, name: 'Existing Staff', backDateAllowedDate: null } });
});
afterEach(cleanup);

describe('one create-user flow', () => {
  it('redirects the old create URL to the Users form and focuses the name', async () => {
    renderApp('/accounts/new');
    await screen.findByRole('heading', { name: 'Create User' });
    expect(screen.getByTestId('location').textContent).toBe('/accounts#create-user');
    expect(screen.getByLabelText(/^Name/)).toBe(document.activeElement);
    expect(screen.getByLabelText(/4-digit PIN/)).toBeTruthy();
    expect(await screen.findByLabelText('Luxury online')).toBeTruthy();
    expect(screen.queryByText('Advanced User Form')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Create New User' })).toBeNull();
    expect(screen.queryByLabelText(/Account Password/)).toBeNull();
  });

  it('header Create User opens the same form with book assignments', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Dashboard content' });
    await user.click(screen.getByRole('link', { name: 'Create User' }));
    await screen.findByRole('heading', { name: 'Create User' });
    await user.type(screen.getByLabelText(/^Name/), 'New Staff');
    await user.type(screen.getByLabelText(/4-digit PIN/), '4829');
    await user.click(await screen.findByLabelText('Luxury online'));
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    await screen.findByText('Staff member “New Staff” created.');
    expect(mocks.create).toHaveBeenCalledWith({ name: 'New Staff', pin: '4829' }, expect.any(String));
    expect(mocks.setBooks).toHaveBeenCalledWith(2, [10]);
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('');
  });

  it('keeps editing existing users available, without the duplicate creation form', async () => {
    renderApp('/accounts/2/edit');
    await screen.findByRole('heading', { name: 'Edit User: Existing Staff' });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeTruthy();
    expect(screen.queryByLabelText(/Staff PIN/)).toBeNull();
  });
});

describe('header navigation drawer', () => {
  it('has no desktop sidebar or reserved sidebar space; navigation only opens from the header menu', async () => {
    const user = userEvent.setup();
    const { container } = renderApp('/');
    await screen.findByRole('heading', { name: 'Dashboard content' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('[class*="lg:pl-64"]')).toBeNull();
    expect(screen.getAllByText('Test Business')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });

  it('opens all admin navigation and places Logout last, then navigates and closes', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'Create User' });
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const nav = screen.getByRole('navigation', { name: 'Header navigation' });
    for (const label of ['Dashboard', 'Entries', 'Users', 'Multi User Report', 'Books', 'Settings', 'Audit', 'Create User', 'New Entry']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
    const panel = nav.parentElement!;
    expect(panel.lastElementChild?.contains(screen.getByRole('button', { name: 'Logout' }))).toBe(true);
    await user.click(within(nav).getByRole('link', { name: 'Books' }));
    await screen.findByRole('heading', { name: 'Books content' });
    expect(screen.queryByRole('navigation', { name: 'Header navigation' })).toBeNull();
  });

  it('supports Escape, keyboard reopening, outside click and toggling closed', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'Create User' });
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    await user.keyboard(' ');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('heading', { name: 'Users & Ledgers' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('logs out only from the menu and goes to login', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await user.click(screen.getByRole('button', { name: 'Logout' }));
    await screen.findByRole('heading', { name: 'Login screen' });
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location').textContent).toBe('/login');
  });

  it('shows staff only their own navigation and Logout', async () => {
    const user = userEvent.setup();
    mocks.role = 'USER';
    renderApp('/');
    await screen.findByRole('heading', { name: 'Staff portal' });
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const nav = screen.getByRole('navigation', { name: 'Header navigation' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['My Deposit & Withdraw']);
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
