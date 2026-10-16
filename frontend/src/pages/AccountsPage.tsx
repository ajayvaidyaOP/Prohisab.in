import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { FileDown, Search, UserPlus, Wallet } from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import type { AccountSummary, BookSummary } from '../lib/types';
import { formatAmount } from '../lib/format';
import { useDebouncedValue, useSettings } from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonRows,
  TextInput,
} from '../components/ui';

const PAGE_SIZE = 20;

export default function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const navState = location.state as { flash?: string } | null;
  const [downloadingSummaryPdf, setDownloadingSummaryPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createPin, setCreatePin] = useState('');
  const [createBookIds, setCreateBookIds] = useState<number[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? 'all';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const debouncedSearch = useDebouncedValue(search, 300);
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const booksQuery = useQuery({ queryKey: ['books'], queryFn: api.books.list });
  const activeBooks = (booksQuery.data ?? []).filter((book) => book.status === 'ACTIVE');

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['accounts', 'list', { search: debouncedSearch, status, page }],
    queryFn: () => api.accounts.list({ search: debouncedSearch || undefined, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const result = await api.accounts.create({ name: createName.trim(), pin: createPin }, newIdempotencyKey());
      if (createBookIds.length > 0) await api.accounts.setBooks(result.account.id, createBookIds);
      return result;
    },
    onSuccess: (result) => {
      setCreateName('');
      setCreatePin('');
      setCreateBookIds([]);
      setCreateError(null);
      setCreatedMessage(`Staff member “${result.account.name}” created.`);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => setCreateError(error instanceof ApiError ? error.message : 'Could not create staff member.'),
  });

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    setCreatedMessage(null);
    if (createName.trim().length < 2) { setCreateError('Enter the staff member’s name.'); return; }
    if (!/^\d{4}$/.test(createPin)) { setCreateError('Enter an exactly 4-digit PIN.'); return; }
    createUser.mutate();
  };

  const handleDownloadSummaryPdf = async () => {
    try {
      setPdfError(null);
      setDownloadingSummaryPdf(true);
      await api.ledger.downloadAllUsersSummaryPdf();
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : 'Could not download All Users Summary PDF.');
    } finally {
      setDownloadingSummaryPdf(false);
    }
  };

  const handleStaffChange = () => {
    void qc.invalidateQueries({ queryKey: ['accounts'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Ledgers"
        description="Create staff, manage PINs and book access, and view deposit / withdrawal ledgers."
        actions={
          <>
            <Button variant="secondary" loading={downloadingSummaryPdf} onClick={() => void handleDownloadSummaryPdf()}>
              <FileDown className="h-4 w-4" aria-hidden="true" /> All Users Summary PDF
            </Button>
            <ButtonLink to="/accounts/new" variant="secondary">
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Advanced User Form
            </ButtonLink>
          </>
        }
      />

      {navState?.flash ? <Alert tone="success">{navState.flash}</Alert> : null}
      {createdMessage ? <Alert tone="success">{createdMessage}</Alert> : null}
      {pdfError ? <Alert tone="error">{pdfError}</Alert> : null}

      <Card>
        <h2 className="mb-1 text-base font-semibold text-slate-900">Create User</h2>
        <p className="mb-4 text-sm text-slate-600">Create a staff login with a name and a unique 4-digit PIN.</p>
        <form className="space-y-4" onSubmit={handleCreate} noValidate>
          {createError && <Alert tone="error">{createError}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              {(id) => <TextInput id={id} value={createName} onChange={(e) => setCreateName(e.target.value)} maxLength={150} placeholder="Staff name" />}
            </Field>
            <Field label="4-digit PIN" required>
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  inputMode="numeric"
                  value={createPin}
                  onChange={(e) => setCreatePin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  maxLength={4}
                  placeholder="••••"
                />
              )}
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Assign books</p>
            {booksQuery.isPending ? <div className="text-sm text-slate-500">Loading books…</div> : activeBooks.length === 0 ? (
              <p className="text-sm text-slate-500">No active books yet. You can add books from the Books page.</p>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {activeBooks.map((book) => (
                  <label key={book.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-600"
                      checked={createBookIds.includes(book.id)}
                      onChange={() => setCreateBookIds((ids) => ids.includes(book.id) ? ids.filter((id) => id !== book.id) : [...ids, book.id])}
                    />
                    {book.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button type="submit" loading={createUser.isPending}>
            <UserPlus className="h-4 w-4" /> Create User
          </Button>
        </form>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Search User">
            {(id) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <TextInput
                  id={id}
                  type="search"
                  placeholder="User name or code"
                  value={search}
                  onChange={(e) => update({ search: e.target.value })}
                  className="pl-9"
                  maxLength={100}
                />
              </div>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <SelectInput id={id} value={status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
                <option value="all">All Users</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectInput>
            )}
          </Field>
        </div>
      </Card>

      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Card padded={false}><SkeletonRows rows={6} cols={3} /></Card>
      ) : query.data.items.length === 0 ? (
        <EmptyState title="No users match these filters." description="Create a user above or try a different search." />
      ) : (
        <div className="space-y-3" aria-busy={query.isFetching}>
          {query.data.items.map((user) => (
            <StaffManagementCard
              key={user.id}
              user={user}
              books={activeBooks}
              today={settings.data?.today ?? new Date().toISOString().slice(0, 10)}
              currencySymbol={symbol}
              onChanged={handleStaffChange}
              onError={setPdfError}
              onOpenLedger={() => void navigate(`/accounts/${user.id}`)}
            />
          ))}
          <Pagination
            page={query.data.pagination.page}
            totalPages={query.data.pagination.totalPages}
            total={query.data.pagination.total}
            onChange={(nextPage) => update({ page: String(nextPage) })}
          />
        </div>
      )}
    </div>
  );
}

function StaffManagementCard({
  user,
  books,
  today,
  currencySymbol,
  onChanged,
  onError,
  onOpenLedger,
}: {
  user: AccountSummary;
  books: BookSummary[];
  today: string;
  currencySymbol: string;
  onChanged: () => void;
  onError: (message: string | null) => void;
  onOpenLedger: () => void;
}) {
  const [pin, setPin] = useState('');
  const [selectedBookIds, setSelectedBookIds] = useState<number[]>(user.allowedBookIds ?? []);
  const [backDate, setBackDate] = useState(user.backDateAllowedDate ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBookIds(user.allowedBookIds ?? []);
    setBackDate(user.backDateAllowedDate ?? '');
  }, [user.allowedBookIds, user.backDateAllowedDate]);

  const setPinOrDisable = async (nextPin: string | null) => {
    setBusy(nextPin === null ? 'disable-pin' : 'pin');
    setNotice(null);
    try {
      await api.accounts.setPin(user.id, nextPin);
      setPin('');
      setNotice(nextPin === null ? 'PIN login disabled.' : 'PIN reset successfully.');
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not update the PIN.');
    } finally {
      setBusy(null);
    }
  };

  const saveBookAccess = async () => {
    setBusy('books');
    setNotice(null);
    try {
      await api.accounts.setBooks(user.id, selectedBookIds);
      setNotice('Book access saved.');
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not save book access.');
    } finally {
      setBusy(null);
    }
  };

  const saveBackDate = async (date: string | null) => {
    setBusy('backdate');
    setNotice(null);
    try {
      await api.accounts.setBackDate(user.id, date);
      setBackDate(date ?? '');
      setNotice(date ? `Back-date access granted for ${date}.` : 'Back-date access revoked.');
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not update back-date access.');
    } finally {
      setBusy(null);
    }
  };

  const downloadToday = async () => {
    setBusy('pdf');
    onError(null);
    try {
      await api.ledger.downloadPdf(user.id, user.name, { from: today, to: today });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not download today’s PDF report.');
    } finally {
      setBusy(null);
    }
  };

  const toggleBook = (id: number) => {
    setSelectedBookIds((ids) => ids.includes(id) ? ids.filter((bookId) => bookId !== id) : [...ids, id]);
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 marker:hidden">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">Staff ID #{user.id} · {user.name} · {user.isActive ? 'Active' : 'Disabled'}</span>
          <span className="mt-1 block text-xs text-slate-500">{user.accountCode} · {user.entryCount} entries · Net {formatAmount(user.pendingBalance, currencySymbol)}</span>
        </span>
        <Badge tone={user.isActive ? 'emerald' : 'slate'}>{user.isActive ? 'Active' : 'Disabled'}</Badge>
      </summary>
      <div className="space-y-5 border-t border-slate-100 p-4">
        {notice && <Alert tone="success">{notice}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy === 'pdf'} onClick={() => void downloadToday()}>
            <FileDown className="h-4 w-4" /> Today PDF Report
          </Button>
          <Button variant="secondary" onClick={onOpenLedger}><Wallet className="h-4 w-4" /> Ledger</Button>
          <Button variant={user.isActive ? 'danger' : 'secondary'} loading={busy === 'status'} onClick={async () => {
            setBusy('status');
            try { await api.accounts.setStatus(user.id, !user.isActive); onChanged(); }
            catch (error) { onError(error instanceof Error ? error.message : 'Could not update the user status.'); }
            finally { setBusy(null); }
          }}>
            {user.isActive ? 'Disable User' : 'Enable User'}
          </Button>
        </div>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">PIN Login</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="New PIN">
                {(id) => (
                  <TextInput id={id} type="password" inputMode="numeric" maxLength={4} placeholder="4 digits"
                    value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                )}
              </Field>
            </div>
            <Button variant="secondary" disabled={!/^\d{4}$/.test(pin)} loading={busy === 'pin'} onClick={() => void setPinOrDisable(pin)}>
              Reset PIN
            </Button>
            {user.hasPin && <Button variant="danger" loading={busy === 'disable-pin'} onClick={() => void setPinOrDisable(null)}>Disable PIN</Button>}
          </div>
          <p className="mt-2 text-xs text-slate-500">{user.hasPin ? 'PIN login is enabled.' : 'PIN login is disabled.'}</p>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Allowed books</h3>
          {books.length === 0 ? <p className="text-sm text-slate-500">No active books to assign.</p> : (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {books.map((book) => (
                <label key={book.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={selectedBookIds.includes(book.id)} onChange={() => toggleBook(book.id)} />
                  {book.name}
                </label>
              ))}
            </div>
          )}
          <Button className="mt-3" variant="secondary" loading={busy === 'books'} onClick={() => void saveBookAccess()}>Save Access</Button>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Back Date Entry Permission</h3>
          <p className="mb-3 text-xs text-slate-500">Allow this staff member to enter transactions for one specific past date.</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Allow entry for date">
                {(id) => <TextInput id={id} type="date" max={today} value={backDate} onChange={(e) => setBackDate(e.target.value)} />}
              </Field>
            </div>
            <Button loading={busy === 'backdate'} disabled={!backDate} onClick={() => void saveBackDate(backDate)}>
              {user.backDateAllowedDate ? 'Update Back Date' : 'Grant Back Date'}
            </Button>
            {user.backDateAllowedDate && <Button variant="danger" loading={busy === 'backdate'} onClick={() => void saveBackDate(null)}>Revoke</Button>}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {user.backDateAllowedDate ? `Permission active for ${user.backDateAllowedDate}.` : 'No back date permission.'}
          </p>
        </section>
      </div>
    </details>
  );
}
