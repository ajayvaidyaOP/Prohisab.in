import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, Skeleton, TextInput } from '../components/ui';

export default function BooksPage() {
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.books.list() });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.books.create(name.trim()),
    onSuccess: () => {
      setName('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create book.'),
  });

  const archive = useMutation({
    mutationFn: (id: number) => api.books.archive(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['books'] }),
  });

  const restore = useMutation({
    mutationFn: (id: number) => api.books.restore(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['books'] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Enter a book name.'); return; }
    create.mutate();
  };

  if (books.isPending) return <Skeleton className="h-64" />;
  if (books.isError) return <ErrorState message={books.error.message} onRetry={() => void books.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Books" description="Manage books (websites/ledgers). Archive or restore as needed." />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <div className="flex-1 min-w-[200px]">
            <Field label="Website / Book name">
              {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Luxury Online" />}
            </Field>
          </div>
          <Button type="submit" loading={create.isPending}>Add Book</Button>
        </form>
      </Card>
      <Card padded={false}>
        {books.data.length === 0 ? (
          <div className="p-6"><EmptyState title="No books yet" description="Add your first book above." /></div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Book ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-right">Entries</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {books.data.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-mono">#{b.id}</td>
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{b.entryCount ?? 0}</td>
                  <td className="px-4 py-3">
                    <Badge tone={b.status === 'ACTIVE' ? 'emerald' : 'slate'}>{b.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.status === 'ACTIVE' ? (
                      <Button variant="secondary" className="!py-1 !px-2 text-xs" loading={archive.isPending} onClick={() => archive.mutate(b.id)}>
                        Delete / Archive
                      </Button>
                    ) : (
                      <Button variant="secondary" className="!py-1 !px-2 text-xs" loading={restore.isPending} onClick={() => restore.mutate(b.id)}>
                        Restore
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
