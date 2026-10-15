/**
 * Display helpers only. Amounts arrive as decimal strings and are formatted by splitting the string,
 * so no binary floating point is involved.
 */

function groupIndian(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const last3 = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** "1234567.5" -> "12,34,567.50" (Indian grouping); negative values keep their sign. */
export function formatAmount(value: string | null | undefined, symbol = '₹'): string {
  if (value === null || value === undefined || value === '') return `${symbol} 0.00`;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart = '0', fracRaw = ''] = unsigned.split('.');
  const frac = fracRaw.padEnd(2, '0').slice(0, 2);
  return `${negative ? '-' : ''}${symbol} ${groupIndian(intPart)}.${frac}`;
}

/** Plain number with grouping and no currency symbol (for tables where the header shows the currency). */
export function formatPlain(value: string | null | undefined): string {
  if (!value) return '0.00';
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart = '0', fracRaw = ''] = unsigned.split('.');
  return `${negative ? '-' : ''}${groupIndian(intPart)}.${fracRaw.padEnd(2, '0').slice(0, 2)}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-10-15" -> "15 Oct 2026". Calendar dates are formatted in UTC so they never shift. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return DATE_FORMAT.format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const TRANSACTION_TYPE_OPTIONS = {
  CUSTOMER: [
    { value: 'CREDIT_SALE', label: 'Credit sale / amount due' },
    { value: 'PAYMENT_RECEIVED', label: 'Payment received' },
    { value: 'CUSTOMER_CREDIT_ADJUSTMENT', label: 'Credit / refund adjustment' },
  ],
  SUPPLIER: [
    { value: 'CREDIT_PURCHASE', label: 'Credit purchase / amount owed' },
    { value: 'PAYMENT_MADE', label: 'Payment made' },
    { value: 'SUPPLIER_CREDIT_ADJUSTMENT', label: 'Credit / return adjustment' },
  ],
} as const;

/** Explains, in plain words, what a transaction type does to the account. */
export const TYPE_EFFECT: Record<string, string> = {
  CREDIT_SALE: 'Increases what the customer owes you (receivable).',
  PAYMENT_RECEIVED: 'Reduces what the customer owes you (receivable).',
  CUSTOMER_CREDIT_ADJUSTMENT: 'Reduces the receivable, for example a refund or credit note given to the customer.',
  CREDIT_PURCHASE: 'Increases what you owe the supplier (payable).',
  PAYMENT_MADE: 'Reduces what you owe the supplier (payable).',
  SUPPLIER_CREDIT_ADJUSTMENT: 'Reduces the payable, for example a return or credit note from the supplier.',
};

/** Accepts up to 2 decimals and the common comma grouping. Returns the cleaned value or null if invalid. */
export function cleanAmountInput(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [int, frac = ''] = cleaned.split('.');
  return `${int}.${frac.padEnd(2, '0')}`;
}

export function isPositiveAmount(value: string | null): boolean {
  return value !== null && /[1-9]/.test(value);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
