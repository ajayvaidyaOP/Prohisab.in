import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, Skeleton, TextInput } from '../components/ui';

export default function MultiReportPage() {
  const accounts = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => api.accounts.list({ pageSize: 100 }) });
  const [selected, setSelected] = useState<number[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [run, setRun] = useState(false);

  const report = useQuery({
    queryKey: ['multi-report', selected, from, to],
    queryFn: () => api.transactions.multiReport(selected.length ? selected : null, from || undefined, to || undefined),
    enabled: run,
  });

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectAll = () => setSelected((accounts.data?.items ?? []).map((a: any) => a.id));

  return (
    <div className="space-y-6">
      <PageHeader title="Multi User Report & PDF History" description="Select users and a date range to generate a combined report." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From Date">
            {(id) => <TextInput id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label="To Date">
            {(id) => <TextInput id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Select Users</span>
            <Button variant="secondary" className="!py-1 !px-2 text-xs" onClick={selectAll}>Select All Users</Button>
          </div>
          {accounts.isPending ? <Skeleton className="h-24" /> : accounts.isError ? <ErrorState message={accounts.error.message} /> : (
            <div className="max-h-48 overflow-y-auto space-y-1 rounded border border-slate-200 p-2">
              {accounts.data.items.map((a: any) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
                  {a.name} (#{a.id})
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setRun(true)} loading={report.isFetching}>Show History</Button>
        </div>
      </Card>

      {run && (
        <Card padded={false}>
          {report.isPending ? <div className="p-6"><Skeleton className="h-40" /></div>
            : report.isError ? <div className="p-6"><ErrorState message={report.error.message} /></div>
            : (report.data ?? []).length === 0 ? <div className="p-6"><EmptyState title="No entries found." /></div>
            : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Time (IST)</th>
                      <th className="px-4 py-3 text-left">Book</th>
                      <th className="px-4 py-3 text-left">Staff</th>
                      <th className="px-4 py-3 text-left">Customer ID</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {(report.data as any[]).map((r: any) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-4 py-3">{formatDateTime(r.createdAt, 'Asia/Kolkata')}</td>
                        <td className="px-4 py-3">{r.bookName ?? '—'}</td>
                        <td className="px-4 py-3">{r.account?.name ?? '—'}</td>
                        <td className="px-4 py-3">{r.customerId ?? '—'}</td>
                        <td className="px-4 py-3">{r.type}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{r.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}
    </div>
  );
}
