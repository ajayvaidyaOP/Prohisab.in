import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, newIdempotencyKey } from './api';

/** Settings change rarely; cache them for the session so pages do not refetch them. */
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.settings.get, staleTime: 5 * 60_000 });
}

/** Everything that shows balances must refresh after a posting, reversal or account change. */
export function invalidateFinancial(qc: QueryClient, accountId?: number) {
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  void qc.invalidateQueries({ queryKey: ['transactions'] });
  void qc.invalidateQueries({ queryKey: ['multi-report'] });
  void qc.invalidateQueries({ queryKey: ['accounts'] });
  void qc.invalidateQueries({ queryKey: ['accountOptions'] });
  void qc.invalidateQueries({ queryKey: ['account'] });
  void qc.invalidateQueries({ queryKey: accountId ? ['ledger', accountId] : ['ledger'] });
  void qc.invalidateQueries({ queryKey: accountId ? ['statement', accountId] : ['statement'] });
}

/**
 * Idempotency keys for writes. The same key is reused while the payload is unchanged, so a retry after a
 * network failure or a double click is safe. A changed payload gets a new key (the server refuses to reuse
 * one key for a different request).
 */
export function useIdempotentKey() {
  const current = useRef<{ payload: string; key: string } | null>(null);
  return {
    keyFor(payload: unknown): string {
      const json = JSON.stringify(payload);
      if (!current.current || current.current.payload !== json) {
        current.current = { payload: json, key: newIdempotencyKey() };
      }
      return current.current.key;
    },
    reset() {
      current.current = null;
    },
  };
}

/** Debounce a value so that typing does not fire a request on every keystroke. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
