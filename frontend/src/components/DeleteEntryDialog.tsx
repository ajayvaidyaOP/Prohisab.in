import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatAmount } from '../lib/format';
import { invalidateFinancial, useIdempotentKey } from '../lib/queries';
import { Alert, Button, Dialog } from './ui';
import type { EntryRow } from './EntryTable';

export function DeleteEntryDialog({ entry, accountId, symbol, onClose }: {
  entry: EntryRow; accountId?: number; symbol: string; onClose: () => void;
}) {
  const client = useQueryClient();
  const retryKey = useIdempotentKey();
  const mutation = useMutation({
    mutationFn: () => api.transactions.delete(entry.id, retryKey.keyFor({ id: entry.id })),
    onSuccess: () => {
      invalidateFinancial(client, 'account' in entry ? entry.account.id : accountId);
      void client.invalidateQueries({ queryKey: ['audit'] });
      onClose();
    },
  });
  const close = () => { if (!mutation.isPending) onClose(); };
  return <Dialog open title={`Delete entry #${entry.id}?`} onClose={close}
    footer={<><Button variant="secondary" disabled={mutation.isPending} onClick={close}>Cancel</Button>
      <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>Delete entry</Button></>}>
    <p className="text-sm text-slate-600">Delete this {entry.direction === 'INCREASE' ? 'deposit' : 'withdrawal'} of <strong>{formatAmount(entry.amount, symbol)}</strong>? It will be removed from the ledger and totals will update immediately. This cannot be undone. A record will remain in the audit history.</p>
    {mutation.isError && <Alert tone="error">{mutation.error.message}</Alert>}
  </Dialog>;
}
