import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, ButtonLink, Card, Field, PageHeader, Pagination, SelectInput, Skeleton } from '../components/ui';
import { useSettings } from '../lib/queries';

const ACTION_LABELS: Record<string, string> = {
  ADMIN_CREATED: 'Administrator created',
  ADMIN_PASSWORD_CHANGED: 'Password changed',
  ADMIN_PASSWORD_RESET_CLI: 'Password reset (command line)',
  ACCOUNT_CREATED: 'Account created',
  ACCOUNT_UPDATED: 'Account updated',
  ACCOUNT_DEACTIVATED: 'Account deactivated',
  ACCOUNT_REACTIVATED: 'Account reactivated',
  USER_CREATED: 'Staff account created',
  USER_UPDATED: 'Staff account updated',
  USER_ACTIVATED: 'Staff account activated',
  USER_DEACTIVATED: 'Staff account deactivated',
  USER_BOOKS_UPDATED: 'Book access changed',
  USER_BACKDATE_UPDATED: 'Back-date permission changed',
  PASSWORD_RESET: 'Password reset',
  PIN_RESET: 'PIN reset',
  PIN_DISABLED: 'PIN disabled',
  LEDGER_ENTRY_CREATED: 'Entry created',
  TRANSACTION_CREATED: 'Entry created',
  TRANSACTION_APPROVED: 'Entry approved',
  TRANSACTION_REJECTED: 'Entry rejected',
  LEDGER_ENTRY_REVERSED: 'Entry reversed',
  TRANSACTION_REVERSED: 'Entry reversed',
  ENTRY_OPTIONS_REPLACED: 'Entry options updated',
  ENTRY_OPTION_CREATED: 'Entry option created',
  ENTRY_OPTION_UPDATED: 'Entry option updated',
  ENTRY_OPTION_DEACTIVATED: 'Entry option deactivated',
  ENTRY_OPTION_DELETED: 'Entry option deleted',
  BOOK_CREATED: 'Book created',
  BOOK_ARCHIVED: 'Book archived',
  BOOK_RESTORED: 'Book restored',
  SETTINGS_UPDATED: 'Settings updated',
  AUTH_LOGIN: 'Signed in',
  AUTH_LOGIN_FAILED: 'Failed sign-in attempt',
  AUTH_LOGOUT: 'Signed out',
};

const ENTITY_TYPES = [
  { value: '', label: 'All activity' },
  { value: 'User', label: 'Staff and sign-in' },
  { value: 'LedgerTransaction', label: 'Ledger entries' },
  { value: 'Book', label: 'Books' },
  { value: 'EntryOption', label: 'Entry options' },
  { value: 'AppSetting', label: 'Business settings' },
];

export default function AuditPage() {
  const settings = useSettings();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const audit = useQuery({
    queryKey: ['audit', { page, entityType }],
    queryFn: () => api.audit({ page, pageSize: 25, entityType: entityType || undefined }),
    placeholderData: keepPreviousData,
  });
  const timezone = settings.data?.business.timezone ?? 'Asia/Kolkata';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity & Audit Trail"
        description="Review administrative and ledger activity. Audit records are read-only and cannot be edited or deleted."
        actions={<ButtonLink to="/settings" variant="secondary">Settings</ButtonLink>}
      />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
            <p className="mt-1 text-sm text-slate-600">Showing the latest events first · {timezone}</p>
          </div>
          <div className="w-full sm:w-64">
            <Field label="Filter activity">
              {(id) => <SelectInput id={id} value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }}>
                {ENTITY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </SelectInput>}
            </Field>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        {audit.isPending ? <div className="p-5"><Skeleton className="h-64" /></div>
          : audit.isError ? <div className="p-5"><Alert tone="error">{audit.error.message}</Alert></div>
          : audit.data.items.length === 0 ? <div className="p-5"><Alert tone="info">No activity recorded for this filter.</Alert></div>
          : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">When</th>
                    <th className="px-4 py-3">Activity</th>
                    <th className="px-4 py-3">Record</th>
                    <th className="px-4 py-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {audit.data.items.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt, timezone)}</td>
                      <td className="px-4 py-3 text-slate-900">
                        <span className="font-medium">{ACTION_LABELS[item.action] ?? item.action.replaceAll('_', ' ').toLowerCase()}</span>
                        <AuditDetails details={item.details} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        <Badge tone="slate">{item.entityType || '—'}</Badge>{item.entityId ? <span className="ml-2 font-mono text-xs">#{item.entityId}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.actor ?? 'System'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {audit.data && <Pagination page={audit.data.pagination.page} totalPages={audit.data.pagination.totalPages} total={audit.data.pagination.total} onChange={setPage} />}
      </Card>
    </div>
  );
}

function AuditDetails({ details }: { details: unknown }) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const values = details as Record<string, unknown>;
  const visibleKeys = ['name', 'targetUser', 'accountCode', 'amount', 'reason', 'date', 'role', 'method', 'books'];
  const parts = visibleKeys.flatMap((key) => {
    const value = values[key];
    if (value === null || value === undefined || typeof value === 'object') {
      return key === 'books' && Array.isArray(value) ? [`books: ${value.join(', ')}`] : [];
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [`${key}: ${value}`];
    return [];
  });
  if (parts.length === 0) return null;
  return <p className="mt-1 break-words text-xs text-slate-500">{parts.join(' · ')}</p>;
}
