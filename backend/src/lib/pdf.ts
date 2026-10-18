/**
 * Zero-dependency PDF 1.4 generator for every ledger export.
 * Uses standard Type1 Helvetica & Helvetica-Bold fonts so it works in all PDF viewers
 * without external binaries or font files.
 *
 * Every entry export (today's dashboard report, the entries report, a user statement and the
 * combined staff report) prints the SAME table as the on-screen entry list:
 *   Time (IST) | Book | Staff | Customer ID | Type | Amount | Bank account | Edit status
 * so a downloaded PDF reads exactly like the screen it was exported from. A single-user
 * statement adds the running Balance column it needs as a statement.
 */

export type Rgb = [number, number, number];

const INK: Rgb = [0.1, 0.14, 0.2];
const MUTED: Rgb = [0.35, 0.4, 0.48];
const DEPOSIT: Rgb = [0.06, 0.48, 0.3];
const WITHDRAW: Rgb = [0.7, 0.18, 0.22];
const EDITED: Rgb = [0.72, 0.42, 0.05];
const BANNER: Rgb = [0.18, 0.22, 0.56];
const HEADER_BG: Rgb = [0.93, 0.95, 0.97];
const STRIPE: Rgb = [0.97, 0.98, 1];
const RULE: Rgb = [0.9, 0.92, 0.95];

/** Standard Type1 WinAnsiEncoding has no U+20B9, so the rupee sign prints as "Rs.". */
function asciiText(text: string): string {
  return text
    .replace(/₹/g, 'Rs. ')
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function pdfEscape(text: string): string {
  return asciiText(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 2)}..`;
}

// Rough Helvetica advance widths (in em) so cells are clipped by width, not by character count.
const NARROW = new Set([...'ijltfrI.,:;\'`"|!()[]{} ']);
const WIDE = new Set([...'MWmw@%']);
function textWidth(text: string, size: number): number {
  let em = 0;
  for (const char of text) {
    em += NARROW.has(char) ? 0.3 : WIDE.has(char) ? 0.86 : /[A-Z0-9$#]/.test(char) ? 0.62 : 0.52;
  }
  return em * size;
}
/** Shortens a value until it fits the column, measuring the characters the viewer will show. */
function fit(text: string, maxWidth: number, size: number): string {
  const clean = asciiText(text).replace(/\s+/g, ' ').trim();
  if (textWidth(clean, size) <= maxWidth) return clean;
  let kept = '';
  for (const char of clean) {
    if (textWidth(`${kept}${char}..`, size) > maxWidth) break;
    kept += char;
  }
  return `${kept.trimEnd()}..`;
}

/** "1234567.5" -> "12,34,567.50" (Indian grouping), matching the on-screen amount column. */
export function formatIndian(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0.00';
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intRaw = '0', fracRaw = ''] = unsigned.split('.');
  const grouped = intRaw.length <= 3
    ? intRaw
    : `${intRaw.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${intRaw.slice(-3)}`;
  return `${negative ? '-' : ''}${grouped}.${fracRaw.padEnd(2, '0').slice(0, 2)}`;
}

/** Same string as the portal's Time (IST) column: YYYY-MM-DD HH:MM:SS in the business zone. */
export function entryTimestamp(iso: string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  } catch {
    return iso.replace('T', ' ').slice(0, 19);
  }
}

/** Content-stream painter shared by every page of every report. */
function painter() {
  const ops: string[] = [];
  return {
    ops,
    text(x: number, y: number, value: string, size = 9, bold = false, rgb: Rgb = INK) {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} rg`);
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(value)}) Tj ET`);
    },
    rect(x: number, y: number, w: number, h: number, rgb: Rgb) {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} rg`);
      ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    },
    line(x1: number, y1: number, x2: number, y2: number, rgb: Rgb = RULE) {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} RG 0.6 w`);
      ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    },
  };
}
type Painter = ReturnType<typeof painter>;

function assemblePdfDocument(pageStreams: string[], pageWidth: number, pageHeight: number): Buffer {
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push(''); // placeholder for 2 0 obj (Pages)
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj');

  pageStreams.forEach((streamContent, idx) => {
    const pageObjNum = 5 + idx * 2;
    const contentObjNum = 6 + idx * 2;
    pageObjNums.push(pageObjNum);

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj`,
    );
    const streamBytes = Buffer.byteLength(streamContent, 'utf8');
    objects.push(`${contentObjNum} 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream\nendobj`);
  });

  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>\nendobj`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

/* ------------------------------------------------------------------ *
 * Entry exports — one shared layout for every "download PDF" button.  *
 * ------------------------------------------------------------------ */

/** One printed line of the entry table; the same fields the Entries screen shows. */
export interface EntryPdfRow {
  createdAt: string;
  entryDate: string;
  bookName: string | null;
  staffName: string;
  customerId: string | null;
  typeLabel: string;
  direction: 'INCREASE' | 'DECREASE';
  amount: string;
  bankDetails: string | null;
  editedAt: string | null;
  isReversed?: boolean;
  approvalStatus?: string;
  runningBalance?: string;
}

export interface EntriesPdfComparison {
  title: string;
  rows: Array<{ label: string; deposits: string; withdrawals: string; net: string;
    totalEntries: number; pendingEntries: number }>;
}

export interface EntriesPdfInput {
  businessName: string;
  title: string;
  subtitle?: string;
  currencySymbol?: string;
  timeZone?: string;
  generatedDate: string;
  fromDate: string | null;
  toDate: string | null;
  summaryLine?: string;
  filterLine?: string;
  totals?: { deposits: string; withdrawals: string; net: string; netLabel?: string };
  comparisons?: EntriesPdfComparison[];
  showBalance?: boolean;
  rows: EntryPdfRow[];
}

const PAGE_W = 841.89; // A4 landscape keeps all entry columns on one line
const PAGE_H = 595.28;
const LEFT = 25;
const RIGHT = PAGE_W - LEFT;
const ROW_H = 17;
const BOTTOM = 44;

interface Column { key: keyof EntryCells; label: string; x: number; w: number }
interface EntryCells {
  time: string; book: string; staff: string; customerId: string;
  type: string; amount: string; bank: string; edit: string; balance: string;
}

// Column order mirrors components/EntryTable.tsx exactly.
const COLUMNS: Column[] = [
  { key: 'time', label: 'TIME (IST)', x: 30, w: 104 },
  { key: 'book', label: 'BOOK', x: 134, w: 100 },
  { key: 'staff', label: 'STAFF', x: 234, w: 110 },
  { key: 'customerId', label: 'CUSTOMER ID', x: 344, w: 96 },
  { key: 'type', label: 'TYPE', x: 440, w: 104 },
  { key: 'amount', label: 'AMOUNT', x: 544, w: 96 },
  { key: 'bank', label: 'BANK ACCOUNT', x: 640, w: 112 },
  { key: 'edit', label: 'EDIT STATUS', x: 752, w: 65 },
];
const COLUMNS_WITH_BALANCE: Column[] = [
  { key: 'time', label: 'TIME (IST)', x: 30, w: 100 },
  { key: 'book', label: 'BOOK', x: 130, w: 92 },
  { key: 'staff', label: 'STAFF', x: 222, w: 92 },
  { key: 'customerId', label: 'CUSTOMER ID', x: 314, w: 76 },
  { key: 'type', label: 'TYPE', x: 390, w: 94 },
  { key: 'amount', label: 'AMOUNT', x: 484, w: 86 },
  { key: 'bank', label: 'BANK ACCOUNT', x: 570, w: 102 },
  { key: 'edit', label: 'EDIT STATUS', x: 672, w: 66 },
  { key: 'balance', label: 'BALANCE', x: 738, w: 79 },
];

function entryCells(row: EntryPdfRow, symbol: string, timeZone: string): EntryCells {
  const notes: string[] = [];
  if (row.isReversed) notes.push('Reversed');
  if (row.approvalStatus === 'REJECTED') notes.push('Rejected');
  else if (row.approvalStatus === 'PENDING') notes.push('Pending');
  return {
    time: entryTimestamp(row.createdAt, timeZone),
    book: row.bookName || '-',
    staff: row.staffName || '-',
    customerId: row.customerId || '-',
    type: notes.length ? `${row.typeLabel} (${notes.join(', ')})` : row.typeLabel,
    amount: `${symbol}${formatIndian(row.amount)}`,
    bank: row.bankDetails || '-',
    edit: row.editedAt ? 'Edited' : 'Original',
    balance: row.runningBalance ? `${symbol}${formatIndian(row.runningBalance)}` : '-',
  };
}

function banner(page: Painter, input: EntriesPdfInput, pageNumber: number, pageCount: number) {
  page.rect(LEFT, 530, PAGE_W - LEFT * 2, 43, BANNER);
  page.text(37, 551, fit(input.businessName.toUpperCase(), 540, 14), 14, true, [1, 1, 1]);
  page.text(37, 536, fit(input.subtitle ? `${input.title}  |  ${input.subtitle}` : input.title, 620, 9.5),
    9.5, true, [0.88, 0.91, 1]);
  page.text(RIGHT - 78, 551, `Page ${pageNumber} of ${pageCount}`, 9, true, [1, 1, 1]);
}

/** Period/filter context, then the four totals shown above the table on screen. */
function entriesIntro(page: Painter, input: EntriesPdfInput, firstPage: boolean): number {
  let y = 512;
  page.text(LEFT + 2, y, `Period: ${input.fromDate || 'Beginning'} to ${input.toDate || 'Latest'}`
    + `   |   Generated: ${input.generatedDate}   |   Entries: ${input.rows.length}`, 8.5, false, MUTED);
  if (!firstPage) return y - 8;
  if (input.summaryLine) { y -= 14; page.text(LEFT + 2, y, fit(input.summaryLine, 780, 9), 9, true, INK); }
  if (input.filterLine) { y -= 13; page.text(LEFT + 2, y, fit(input.filterLine, 785, 8), 8, false, MUTED); }
  if (input.totals) {
    const symbol = input.currencySymbol ?? '₹';
    const cards: Array<{ label: string; value: string; bg: Rgb; fg: Rgb }> = [
      { label: 'TOTAL DEPOSIT (+)', value: `${symbol}${formatIndian(input.totals.deposits)}`,
        bg: [0.93, 0.98, 0.95], fg: DEPOSIT },
      { label: 'TOTAL WITHDRAWAL (-)', value: `${symbol}${formatIndian(input.totals.withdrawals)}`,
        bg: [1, 0.95, 0.95], fg: WITHDRAW },
      { label: input.totals.netLabel ?? 'NET (DEPOSIT - WITHDRAWAL)', value: `${symbol}${formatIndian(input.totals.net)}`,
        bg: [0.94, 0.96, 1], fg: [0.22, 0.3, 0.68] },
      { label: 'TOTAL ENTRIES', value: String(input.rows.length), bg: [0.96, 0.95, 1], fg: [0.36, 0.26, 0.68] },
    ];
    const gap = 8;
    const cardW = (PAGE_W - LEFT * 2 - gap * 3) / 4;
    const top = y - 10;
    cards.forEach((card, index) => {
      const x = LEFT + index * (cardW + gap);
      page.rect(x, top - 42, cardW, 42, card.bg);
      page.text(x + 9, top - 16, fit(card.label, cardW - 18, 7.5), 7.5, true, card.fg);
      page.text(x + 9, top - 33, fit(card.value, cardW - 18, 12), 12, true, card.fg);
    });
    y = top - 42;
  }
  return y - 8;
}

function entriesTableHeader(page: Painter, columns: Column[], top: number) {
  page.rect(LEFT, top - 20, PAGE_W - LEFT * 2, 20, HEADER_BG);
  for (const column of columns) {
    page.text(column.x, top - 13.5, fit(column.label, column.w - 4, 8), 8, true, [0.25, 0.3, 0.38]);
  }
}

function entriesTableRows(page: Painter, columns: Column[], top: number, rows: EntryPdfRow[],
  symbol: string, timeZone: string) {
  const body = top - 20; // below the heading band
  if (!rows.length) {
    page.text(30, body - 16, 'No entries match these filters.', 9.5, false, MUTED);
    return;
  }
  rows.forEach((row, index) => {
    const rowY = body - (index + 1) * ROW_H;
    if (index % 2) page.rect(LEFT, rowY, PAGE_W - LEFT * 2, ROW_H, STRIPE);
    page.line(LEFT, rowY, RIGHT, rowY);
    const cells = entryCells(row, symbol, timeZone);
    const tone: Rgb = row.direction === 'INCREASE' ? DEPOSIT : WITHDRAW;
    for (const column of columns) {
      const value = cells[column.key];
      const bold = column.key === 'amount' || column.key === 'balance';
      const colour = column.key === 'type' ? tone
        : column.key === 'edit' ? (cells.edit === 'Edited' ? EDITED : MUTED)
          : column.key === 'book' || column.key === 'customerId' || column.key === 'bank' ? MUTED : INK;
      const size = column.key === 'type' || column.key === 'edit' ? 7.5 : 8;
      page.text(column.x, rowY + 5.5, fit(value, column.w - 6, size), size, bold, colour);
    }
  });
}

function entriesFooter(page: Painter, input: EntriesPdfInput, note: string) {
  page.line(LEFT, 36, RIGHT, 36);
  page.text(LEFT + 2, 24, `${input.businessName} - ${note}`, 7.5, false, [0.5, 0.55, 0.6]);
}

/** Staff-wise / book-wise comparison pages that precede the combined history. */
function comparisonPages(input: EntriesPdfInput, streams: string[]) {
  for (const section of input.comparisons ?? []) {
    const perPage = 22;
    const pages = Math.max(1, Math.ceil(section.rows.length / perPage));
    const symbol = input.currencySymbol ?? '₹';
    for (let index = 0; index < pages; index++) {
      const page = painter();
      page.rect(LEFT, 530, PAGE_W - LEFT * 2, 43, BANNER);
      page.text(37, 551, fit(input.businessName.toUpperCase(), 540, 14), 14, true, [1, 1, 1]);
      page.text(37, 536, section.title, 10, true, [0.88, 0.91, 1]);
      page.text(RIGHT - 78, 551, `Page ${index + 1} of ${pages}`, 9, true, [1, 1, 1]);
      page.text(LEFT + 2, 512, `Period: ${input.fromDate || 'Beginning'} to ${input.toDate || 'Latest'}`
        + `   |   Generated: ${input.generatedDate}`, 8.5, false, MUTED);
      if (input.summaryLine) page.text(LEFT + 2, 498, fit(input.summaryLine, 780, 9), 9, true, INK);
      if (input.filterLine) page.text(LEFT + 2, 485, fit(input.filterLine, 785, 8), 8, false, MUTED);
      const top = 468;
      page.rect(LEFT, top - 20, PAGE_W - LEFT * 2, 20, HEADER_BG);
      const columns: Array<[number, number, string]> = [[30, 215, 'NAME'], [250, 120, 'COLLECTION (+)'],
        [375, 120, 'WITHDRAWALS (-)'], [500, 125, 'PERIOD NET'], [630, 85, 'ENTRIES'], [720, 95, 'PENDING']];
      for (const [x, w, label] of columns) page.text(x, top - 13.5, fit(label, w - 4, 8), 8, true, [0.25, 0.3, 0.38]);
      const rows = section.rows.slice(index * perPage, (index + 1) * perPage);
      if (!rows.length) page.text(30, top - 36, 'No matching entries.', 9.5, false, MUTED);
      rows.forEach((row, rowIndex) => {
        const y = top - 20 - (rowIndex + 1) * ROW_H;
        if (rowIndex % 2) page.rect(LEFT, y, PAGE_W - LEFT * 2, ROW_H, STRIPE);
        page.line(LEFT, y, RIGHT, y);
        const values: Array<[number, number, string, boolean, Rgb]> = [
          [30, 215, row.label, false, INK],
          [250, 120, `${symbol}${formatIndian(row.deposits)}`, false, DEPOSIT],
          [375, 120, `${symbol}${formatIndian(row.withdrawals)}`, false, WITHDRAW],
          [500, 125, `${symbol}${formatIndian(row.net)}`, true, INK],
          [630, 85, String(row.totalEntries), false, MUTED],
          [720, 95, String(row.pendingEntries), false, MUTED],
        ];
        for (const [x, w, value, bold, colour] of values) page.text(x, y + 5.5, fit(value, w - 4, 8), 8, bold, colour);
      });
      entriesFooter(page, input, `${section.title} - approved amounts only; period net is not an all-time balance`);
      streams.push(page.ops.join('\n'));
    }
  }
}

/**
 * Renders any list of entries with the on-screen entry table layout.
 * Used by the dashboard, entries report, user statement and combined staff report so every
 * downloaded PDF has an identical structure.
 */
export function buildEntriesPdf(input: EntriesPdfInput): Buffer {
  const columns = input.showBalance ? COLUMNS_WITH_BALANCE : COLUMNS;
  const symbol = input.currencySymbol ?? '₹';
  const timeZone = input.timeZone ?? 'Asia/Kolkata';
  const streams: string[] = [];
  comparisonPages(input, streams);

  // Capacity differs on page 1 because the totals cards and filter lines sit above the table.
  const probe = painter();
  const firstTop = entriesIntro(probe, input, true);
  const nextTop = entriesIntro(painter(), input, false);
  const capacity = (top: number) => Math.max(1, Math.floor((top - 20 - BOTTOM) / ROW_H));
  const firstCapacity = capacity(firstTop);
  const nextCapacity = capacity(nextTop);

  const pages: EntryPdfRow[][] = [];
  if (!input.rows.length) pages.push([]);
  else {
    pages.push(input.rows.slice(0, firstCapacity));
    for (let offset = firstCapacity; offset < input.rows.length; offset += nextCapacity) {
      pages.push(input.rows.slice(offset, offset + nextCapacity));
    }
  }

  pages.forEach((rows, index) => {
    const page = painter();
    banner(page, input, index + 1, pages.length);
    const top = entriesIntro(page, input, index === 0);
    entriesTableHeader(page, columns, top);
    entriesTableRows(page, columns, top, rows, symbol, timeZone);
    entriesFooter(page, input,
      'Computer generated deposit & withdrawal entries (same columns as the Entries screen)');
    streams.push(page.ops.join('\n'));
  });

  return assemblePdfDocument(streams, PAGE_W, PAGE_H);
}

/* ------------------------------------------------------------------ *
 * All-users summary — per-user totals, not an entry list.             *
 * ------------------------------------------------------------------ */

export interface AllUsersSummaryPdfRow {
  accountCode: string;
  name: string;
  username: string | null;
  totalDeposit: string;
  totalWithdrawal: string;
  netBalance: string;
  pendingCount: number;
  pendingAmount: string;
}

export interface AllUsersSummaryPdfInput {
  businessName: string;
  generatedDate: string;
  currencySymbol?: string;
  totalDeposit: string;
  totalWithdrawal: string;
  totalNetBalance: string;
  totalPendingCount: number;
  totalPendingAmount: string;
  rows: AllUsersSummaryPdfRow[];
}

export function buildAllUsersSummaryPdf(input: AllUsersSummaryPdfInput): Buffer {
  const pageWidth = 595.28; // A4 portrait
  const pageHeight = 841.89;
  const rowsPerFirstPage = 24;
  const rowsPerNextPage = 32;
  const symbol = input.currencySymbol ?? '₹';

  const pages: AllUsersSummaryPdfRow[][] = [];
  if (input.rows.length === 0) {
    pages.push([]);
  } else {
    pages.push(input.rows.slice(0, rowsPerFirstPage));
    let offset = rowsPerFirstPage;
    while (offset < input.rows.length) {
      pages.push(input.rows.slice(offset, offset + rowsPerNextPage));
      offset += rowsPerNextPage;
    }
  }

  const pageStreams: string[] = [];

  pages.forEach((pageRows, pageIndex) => {
    const page = painter();
    let y = pageHeight - 45;

    page.rect(35, y - 28, pageWidth - 70, 42, BANNER);
    page.text(48, y - 4, input.businessName.toUpperCase(), 13, true, [1, 1, 1]);
    page.text(48, y - 19, `ALL USERS DEPOSIT & WITHDRAWAL SUMMARY REPORT (${input.rows.length} USERS)`,
      9.5, false, [0.88, 0.91, 1]);
    page.text(pageWidth - 115, y - 12, `Page ${pageIndex + 1} of ${pages.length}`, 9, true, [1, 1, 1]);
    y -= 44;

    if (pageIndex === 0) {
      page.text(38, y, `Generated on: ${input.generatedDate}`, 8.5, false, MUTED);
      y -= 14;

      const boxW = (pageWidth - 70 - 16) / 3;
      const boxH = 44;
      const boxY = y - boxH;

      page.rect(35, boxY, boxW, boxH, [0.93, 0.98, 0.95]);
      page.text(44, boxY + 28, 'TOTAL DEPOSITS (+)', 7.5, true, DEPOSIT);
      page.text(44, boxY + 11, `${symbol}${formatIndian(input.totalDeposit)}`, 12, true, [0.04, 0.38, 0.24]);

      page.rect(35 + boxW + 8, boxY, boxW, boxH, [1, 0.95, 0.95]);
      page.text(44 + boxW + 8, boxY + 28, 'TOTAL WITHDRAWALS (-)', 7.5, true, WITHDRAW);
      page.text(44 + boxW + 8, boxY + 11, `${symbol}${formatIndian(input.totalWithdrawal)}`, 12, true, [0.55, 0.12, 0.16]);

      page.rect(35 + (boxW + 8) * 2, boxY, boxW, boxH, [0.94, 0.96, 1]);
      page.text(44 + (boxW + 8) * 2, boxY + 28, 'TOTAL NET BALANCE', 7.5, true, [0.22, 0.3, 0.68]);
      page.text(44 + (boxW + 8) * 2, boxY + 11, `${symbol}${formatIndian(input.totalNetBalance)}`, 12, true, [0.1, 0.15, 0.35]);

      y = boxY - 18;
    }

    const tableHeaderY = y - 18;
    page.rect(35, tableHeaderY, pageWidth - 70, 20, HEADER_BG);
    page.text(40, tableHeaderY + 6, 'CODE', 8, true, [0.25, 0.3, 0.38]);
    page.text(105, tableHeaderY + 6, 'USER NAME', 8, true, [0.25, 0.3, 0.38]);
    page.text(230, tableHeaderY + 6, 'LOGIN ID', 8, true, [0.25, 0.3, 0.38]);
    page.text(310, tableHeaderY + 6, 'DEPOSIT (+)', 8, true, [0.25, 0.3, 0.38]);
    page.text(390, tableHeaderY + 6, 'WITHDRAW (-)', 8, true, [0.25, 0.3, 0.38]);
    page.text(470, tableHeaderY + 6, 'NET BALANCE', 8, true, [0.25, 0.3, 0.38]);
    y = tableHeaderY;

    if (pageRows.length === 0) {
      page.text(40, y - 22, 'No users found.', 9, false, [0.45, 0.5, 0.56]);
    } else {
      pageRows.forEach((row, idx) => {
        const rowH = 19;
        const rowY = y - rowH;
        if (idx % 2 === 1) page.rect(35, rowY, pageWidth - 70, rowH, [0.98, 0.99, 1]);
        page.line(35, rowY, pageWidth - 35, rowY);

        page.text(40, rowY + 6, row.accountCode, 8, false, MUTED);
        page.text(105, rowY + 6, truncate(row.name, 22), 8.5, true, INK);
        page.text(230, rowY + 6, truncate(row.username || row.name, 14), 8, false, MUTED);
        page.text(310, rowY + 6, `${symbol}${formatIndian(row.totalDeposit)}`, 8, true, DEPOSIT);
        page.text(390, rowY + 6, `${symbol}${formatIndian(row.totalWithdrawal)}`, 8, true, WITHDRAW);
        page.text(470, rowY + 6, `${symbol}${formatIndian(row.netBalance)}`, 8.5, true, INK);

        y = rowY;
      });
    }

    page.line(35, 38, pageWidth - 35, 38);
    page.text(38, 25, `${input.businessName} - All Users Deposit & Withdrawal Summary Report`, 7.5, false, [0.5, 0.55, 0.6]);

    pageStreams.push(page.ops.join('\n'));
  });

  return assemblePdfDocument(pageStreams, pageWidth, pageHeight);
}
