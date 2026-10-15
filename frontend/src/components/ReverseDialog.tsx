import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { formatAmount, formatDate } from '../lib/format';
import { invalidateFinancial, useIdempotentKey, useSettings } from '../lib/queries';
import { Alert, Button, Dialog, Field, TextArea, TextInput } from './ui';

export type ReversibleEntry = { id: number; entryDate: string; typeLabel: string; amount: string };

/**
 * Corrections never edit or delete a posted entry. This dialog creates a reversal entry that mirrors the
 * original amount on the opposite direction, referencing it and recording the reason in the audit log.
 */
export function ReverseDialog({ entry, accountId, open, onClose }: { entry: ReversibleEntry | null; accountId?: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const today = settings.data?.today ?? '';
  const symbol = settings.data?.business.currencySymbol ?? '₹';
  const idempotency = useIdempotentKey();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();

  const reverse = useMutation({
    mutationFn: (body: { reason: string; entryDate?: string }) => api.transactions.reverse(entry!.id, body, idempotency.keyFor({ id: entry!.id, ...body })),
    onSuccess: (result) => {
      idempotency.reset();
      invalidateFinancial(qc, result.account.id);
      setReason('');
      setDate('');
      setError(null);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'ALREADY_REVERSED') {
        // Another user or tab reversed it first: refresh and explain.
        invalidateFinancial(qc, accountId);
      }
      setError(err instanceof ApiError ? err.message : 'The reversal could not be saved. Please try again.');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setReasonError('Describe why this entry is being reversed (at least 3 characters).');
      return;
    }
    setReasonError(undefined);
    setError(null);
    reverse.mutate({ reason: reason.trim(), ...(date && date !== entry?.entryDate ? { entryDate: date } : {}) });
  };

  if (!entry) return null;
  const minDate = entry.entryDate;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!reverse.isPending) onClose();
      }}
      title="Reverse this entry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={reverse.isPending}>
            Keep entry
          </Button>
          <Button type="submit" form="reverse-form" variant="danger" loading={reverse.isPending}>
            Create reversal
          </Button>
        </>
      }
    >
      <form id="reverse-form" className="space-y-4" onSubmit={submit} noValidate>
        <Alert tone="info" title={`${entry.typeLabel} · ${formatAmount(entry.amount, symbol)}`}>
          The original entry from {formatDate(entry.entryDate)} stays in the ledger unchanged. A reversal entry with the opposite direction is added so the balance is corrected.
        </Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Reason" required error={reasonError} hint="Shown in the reversal note and the audit log.">
          {(id, describedBy) => (
            <TextArea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} aria-describedby={describedBy} invalid={!!reasonError} placeholder="For example: entered twice" />
          )}
        </Field>
        <Field label="Reversal date" hint={`Defaults to today (${formatDate(today)}). It cannot be earlier than the original entry.`}>
          {(id) => <TextInput id={id} type="date" value={date || today} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <p className="text-xs text-slate-500">Earliest allowed date: {formatDate(minDate)}.</p>
      </form>
    </Dialog>
  );
}
