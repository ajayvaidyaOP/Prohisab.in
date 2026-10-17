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

/** "2026-10-17" -> "17-10-2026" (the DD-MM-YYYY format used across the user portal). */
export function toDisplayDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}-${m}-${y}` : isoDate;
}

const DISPLAY_DATE_PATTERN = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;

/** "17-10-2026" -> "2026-10-17", or null when the text is not a real calendar date. */
export function parseDisplayDate(value: string): string | null {
  const match = DISPLAY_DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, dayRaw, monthRaw, yearRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${yearRaw}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "2026-10-17T09:30:05Z" -> "09:30:05" in the business time zone (the portal's Time (IST) column). */
export function formatTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 19);
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
    { value: 'CREDIT_SALE', label: '+ Deposit (Money Added / Jama)' },
    { value: 'PAYMENT_RECEIVED', label: '- Withdrawal (Money Withdrawn / Nikala)' },
    { value: 'CUSTOMER_CREDIT_ADJUSTMENT', label: 'Balance Adjustment' },
  ],
  SUPPLIER: [
    { value: 'CREDIT_PURCHASE', label: '+ Deposit (Money Added / Jama)' },
    { value: 'PAYMENT_MADE', label: '- Withdrawal (Money Withdrawn / Nikala)' },
    { value: 'SUPPLIER_CREDIT_ADJUSTMENT', label: 'Balance Adjustment' },
  ],
} as const;

/** Explains, in plain words, what a transaction type does to the account. */
export const TYPE_EFFECT: Record<string, string> = {
  DEPOSIT: 'Deposit (+): Increases the user’s balance.',
  WITHDRAWAL: 'Withdrawal (-): Reduces the user’s balance.',
  REVERSAL: 'Reversal: Offsets a previous entry.',
  CREDIT_SALE: 'Deposit (+): Increases the user’s balance.',
  PAYMENT_RECEIVED: 'Withdrawal (-): Reduces the user’s balance.',
  CUSTOMER_CREDIT_ADJUSTMENT: 'Adjusts the user’s balance.',
  CREDIT_PURCHASE: 'Deposit (+): Increases the user’s balance.',
  PAYMENT_MADE: 'Withdrawal (-): Reduces the user’s balance.',
  SUPPLIER_CREDIT_ADJUSTMENT: 'Adjusts the user’s balance.',
};

export function displayEntryLabel(type: string, fallback?: string): string {
  switch (type) {
    case 'DEPOSIT':
    case 'CREDIT_PURCHASE':
    case 'CREDIT_SALE':
      return '+ Deposit';
    case 'WITHDRAWAL':
    case 'PAYMENT_MADE':
    case 'PAYMENT_RECEIVED':
      return '- Withdrawal';
    case 'SUPPLIER_CREDIT_ADJUSTMENT':
    case 'CUSTOMER_CREDIT_ADJUSTMENT':
      return 'Adjustment';
    case 'REVERSAL':
      return 'Reversal';
    default:
      return fallback ?? type;
  }
}

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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Returns { from, to, label } for This Month (offset=0) or Last Month (offset=-1). */
export function getMonthRange(todayIso: string, offsetMonths: 0 | -1): { from: string; to: string; label: string } {
  const [yRaw, mRaw] = todayIso.split('-').map(Number);
  const baseYear = yRaw || new Date().getUTCFullYear();
  const baseMonthIndex = (mRaw || new Date().getUTCMonth() + 1) - 1;
  const targetDate = new Date(Date.UTC(baseYear, baseMonthIndex + offsetMonths, 1));
  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth(); // 0..11
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const mm = String(month + 1).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const to = offsetMonths === 0 ? todayIso : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return {
    from,
    to,
    label: `${MONTH_NAMES[month]} ${year}`,
  };
}


/** Reference entry table uses a recorded timestamp in IST, independent of the ledger date. */
export function formatEntryTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
