import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from '../src/pages/SettingsPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), password: vi.fn(), audit: vi.fn() }));
vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  api: { settings: { get: mocks.get, update: mocks.update }, auth: { changePassword: mocks.password }, audit: mocks.audit },
}));
const business = {
  businessName: 'JKLM', logoUrl: 'https://example.com/logo.png', currencySymbol: '₹', timezone: 'Asia/Kolkata',
  businessAddress: 'Existing address', businessPhone: '1234567890', businessEmail: 'admin@example.com',
  userEntryOptions: ['Cash Deposit', 'Cash Withdrawal'], updatedAt: '2026-10-18T00:00:00Z',
};
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  mocks.get.mockResolvedValue({ business, today: '2026-10-18', user: { username: 'admin' }, session: { idleTimeoutMinutes: 30 } });
  mocks.update.mockImplementation(async (body) => ({ business: { ...business, ...body }, today: '2026-10-18' }));
  mocks.password.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('shows only company branding followed by the admin password form', async () => {
  renderPage();
  await screen.findByLabelText('Company name');
  expect(screen.getAllByRole('textbox')).toHaveLength(2);
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Save', 'Change Password']);
  expect(screen.getByLabelText('Logo URL')).toBeTruthy();
  for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
    expect((screen.getByLabelText(label) as HTMLInputElement).type).toBe('password');
  }
  expect(screen.getAllByRole('form').map((form) => form.getAttribute('aria-label'))).toEqual(['Company settings', 'Change admin password']);
  for (const text of ['Activity log', 'Entry options', 'Currency symbol', 'Time zone', 'Address', 'Phone', 'Email']) {
    expect(screen.queryByText(text)).toBeNull();
  }
  expect(mocks.audit).not.toHaveBeenCalled();
});

it('saves name/logo without clearing hidden settings and updates shared branding immediately', async () => {
  const user = userEvent.setup();
  const client = renderPage();
  const name = await screen.findByLabelText('Company name');
  await user.clear(name);
  await user.type(name, ' New Company ');
  await user.clear(screen.getByLabelText('Logo URL'));
  await user.type(screen.getByLabelText('Logo URL'), 'https://example.com/new.png');
  // Keep subsequent settings refresh aligned with the saved server response.
  mocks.get.mockResolvedValue({ business: { ...business, businessName: 'New Company', logoUrl: 'https://example.com/new.png' }, today: '2026-10-18' });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Settings saved.');
  expect(mocks.update).toHaveBeenCalledWith({ businessName: 'New Company', logoUrl: 'https://example.com/new.png',
    businessAddress: business.businessAddress, businessPhone: business.businessPhone, businessEmail: business.businessEmail,
    currencySymbol: '₹', timezone: 'Asia/Kolkata' });
  await waitFor(() => expect(client.getQueryData<{ business: typeof business }>(['settings'])?.business.businessName).toBe('New Company'));
});

it('allows clearing the logo without changing company or reporting settings', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.clear(await screen.findByLabelText('Logo URL'));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Settings saved.');
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: null, businessName: 'JKLM', timezone: 'Asia/Kolkata' }));
});

it('validates company name and logo URL before saving', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.clear(await screen.findByLabelText('Company name'));
  await user.clear(screen.getByLabelText('Logo URL'));
  await user.type(screen.getByLabelText('Logo URL'), 'javascript:alert(1)');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText(/at least 2 characters/)).toBeTruthy();
  expect(screen.getByText(/valid HTTP or HTTPS/)).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('validates passwords, calls the existing secure API, and clears all password fields', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByLabelText('Current Password');
  const change = screen.getByRole('button', { name: 'Change Password' });
  await user.click(change);
  expect(screen.getByRole('alert').textContent).toContain('required');
  await user.type(screen.getByLabelText('Current Password'), 'Current123');
  await user.type(screen.getByLabelText('New Password'), 'NewPass123');
  await user.type(screen.getByLabelText('Confirm New Password'), 'Different123');
  await user.click(change);
  expect(screen.getByRole('alert').textContent).toContain('do not match');
  expect(mocks.password).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Confirm New Password'));
  await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass123');
  await user.click(change);
  await screen.findByText('Password changed.');
  expect(mocks.password).toHaveBeenCalledWith({ currentPassword: 'Current123', newPassword: 'NewPass123', confirmPassword: 'NewPass123' });
  for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
  }
});

it('keeps forms available when saving settings or changing a password fails', async () => {
  const user = userEvent.setup();
  mocks.update.mockRejectedValue(new Error('Could not save settings.'));
  mocks.password.mockRejectedValue(new Error('Current password is incorrect.'));
  renderPage();
  await screen.findByLabelText('Company name');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Could not save settings.');
  await user.type(screen.getByLabelText('Current Password'), 'Incorrect123');
  await user.type(screen.getByLabelText('New Password'), 'NewPass123');
  await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass123');
  await user.click(screen.getByRole('button', { name: 'Change Password' }));
  await screen.findByText('Current password is incorrect.');
  expect((screen.getByRole('button', { name: 'Change Password' }) as HTMLButtonElement).disabled).toBe(false);
});
