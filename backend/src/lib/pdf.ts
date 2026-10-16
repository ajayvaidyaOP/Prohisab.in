/**
 * Zero-dependency PDF 1.4 generator for User Ledger Statements & All-Users Summary Reports.
 * Uses standard Type1 Helvetica & Helvetica-Bold fonts so it works in all PDF viewers
 * without external binaries or font files.
 */

export interface LedgerPdfRow {
  id: number;
  entryDate: string;
  description: string;
  paymentMethod: string;
  status: string;
  increase: string;
  decrease: string;
  runningBalance: string;
}

export interface LedgerPdfInput {
  businessName: string;
  accountName: string;
  accountCode: string;
  fromDate: string | null;
  toDate: string | null;
  generatedDate: string;
  totalCredited: string;
  totalSettled: string;
  outstandingBalance: string;
  pendingSubmissionsAmount: string;
  rows: LedgerPdfRow[];
}

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
  totalDeposit: string;
  totalWithdrawal: string;
  totalNetBalance: string;
  totalPendingCount: number;
  totalPendingAmount: string;
  rows: AllUsersSummaryPdfRow[];
}

function pdfEscape(text: string): string {
  // Replace rupee symbol ₹ with Rs. because standard Type1 WinAnsiEncoding does not include U+20B9
  const ascii = text
    .replace(/₹/g, 'Rs. ')
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 2)}..`;
}

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

export function buildLedgerPdf(input: LedgerPdfInput): Buffer {
  const pageWidth = 595.28; // A4 width in points
  const pageHeight = 841.89; // A4 height in points
  const rowsPerFirstPage = 24;
  const rowsPerNextPage = 32;

  const pages: LedgerPdfRow[][] = [];
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
    const ops: string[] = [];
    let y = pageHeight - 45;

    const text = (x: number, yPos: number, str: string, size = 9, bold = false, rgb: [number, number, number] = [0.1, 0.14, 0.2]) => {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} rg`);
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${yPos.toFixed(2)} Td (${pdfEscape(str)}) Tj ET`);
    };

    const rectFill = (x: number, yPos: number, w: number, h: number, rgb: [number, number, number]) => {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} rg`);
      ops.push(`${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    };

    const line = (x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.85, 0.88, 0.92]) => {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} RG 0.6 w`);
      ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    };

    // Top Header Banner
    rectFill(35, y - 28, pageWidth - 70, 42, [0.18, 0.22, 0.56]);
    text(48, y - 4, input.businessName.toUpperCase(), 13, true, [1, 1, 1]);
    text(
      48,
      y - 19,
      `USER DEPOSIT & WITHDRAWAL LEDGER  |  ${input.accountName} (${input.accountCode})`,
      9.5,
      false,
      [0.88, 0.91, 1],
    );
    text(pageWidth - 115, y - 12, `Page ${pageIndex + 1} of ${pages.length}`, 9, true, [1, 1, 1]);
    y -= 44;

    if (pageIndex === 0) {
      const periodText = `Period: ${input.fromDate ?? 'Start'} to ${input.toDate ?? input.generatedDate}   |   Generated: ${input.generatedDate}`;
      text(38, y, periodText, 8.5, false, [0.35, 0.4, 0.48]);
      y -= 14;

      // 3 Summary Cards
      const boxW = (pageWidth - 70 - 16) / 3;
      const boxH = 44;
      const boxY = y - boxH;

      // Box 1: Total Deposit (+)
      rectFill(35, boxY, boxW, boxH, [0.93, 0.98, 0.95]);
      text(44, boxY + 28, 'TOTAL DEPOSIT (+)', 7.5, true, [0.06, 0.48, 0.3]);
      text(44, boxY + 11, `Rs. ${input.totalCredited}`, 12, true, [0.04, 0.38, 0.24]);

      // Box 2: Total Withdrawal (-)
      rectFill(35 + boxW + 8, boxY, boxW, boxH, [1, 0.95, 0.95]);
      text(44 + boxW + 8, boxY + 28, 'TOTAL WITHDRAWAL (-)', 7.5, true, [0.7, 0.18, 0.22]);
      text(44 + boxW + 8, boxY + 11, `Rs. ${input.totalSettled}`, 12, true, [0.55, 0.12, 0.16]);

      // Box 3: Net Balance
      rectFill(35 + (boxW + 8) * 2, boxY, boxW, boxH, [0.94, 0.96, 1]);
      text(44 + (boxW + 8) * 2, boxY + 28, 'NET BALANCE (DEPOSIT - WITHDRAW)', 7, true, [0.22, 0.3, 0.68]);
      text(44 + (boxW + 8) * 2, boxY + 11, `Rs. ${input.outstandingBalance}`, 12, true, [0.1, 0.15, 0.35]);

      y = boxY - 18;
    }

    // Table Header
    const tableHeaderY = y - 18;
    rectFill(35, tableHeaderY, pageWidth - 70, 20, [0.93, 0.95, 0.97]);
    text(40, tableHeaderY + 6, 'DATE', 8, true, [0.25, 0.3, 0.38]);
    text(100, tableHeaderY + 6, 'OPTION / REMARK', 8, true, [0.25, 0.3, 0.38]);
    text(275, tableHeaderY + 6, 'MODE', 8, true, [0.25, 0.3, 0.38]);
    text(330, tableHeaderY + 6, 'STATUS', 8, true, [0.25, 0.3, 0.38]);
    text(392, tableHeaderY + 6, 'DEPOSIT (+)', 8, true, [0.25, 0.3, 0.38]);
    text(456, tableHeaderY + 6, 'WITHDRAW (-)', 8, true, [0.25, 0.3, 0.38]);
    text(516, tableHeaderY + 6, 'BALANCE', 8, true, [0.25, 0.3, 0.38]);
    y = tableHeaderY;

    if (pageRows.length === 0) {
      text(40, y - 22, 'No ledger transactions found for this period.', 9, false, [0.45, 0.5, 0.56]);
    } else {
      pageRows.forEach((row, idx) => {
        const rowH = 19;
        const rowY = y - rowH;
        if (idx % 2 === 1) {
          rectFill(35, rowY, pageWidth - 70, rowH, [0.98, 0.99, 1]);
        }
        line(35, rowY, pageWidth - 35, rowY, [0.9, 0.92, 0.95]);

        text(40, rowY + 6, row.entryDate, 8, false);
        text(100, rowY + 6, truncate(row.description, 33), 8, false);
        text(275, rowY + 6, truncate(row.paymentMethod || '-', 10), 7.5, false, [0.35, 0.4, 0.48]);

        const statusColor: [number, number, number] =
          row.status === 'APPROVED'
            ? [0.06, 0.48, 0.3]
            : row.status === 'PENDING'
              ? [0.7, 0.42, 0.05]
              : [0.65, 0.15, 0.15];
        text(330, rowY + 6, row.status, 7.5, true, statusColor);

        text(392, rowY + 6, row.increase ? `+ ${row.increase}` : '-', 8, Boolean(row.increase), [0.06, 0.48, 0.3]);
        text(456, rowY + 6, row.decrease ? `- ${row.decrease}` : '-', 8, Boolean(row.decrease), [0.7, 0.18, 0.22]);
        text(516, rowY + 6, row.runningBalance, 8, true, [0.1, 0.14, 0.2]);

        y = rowY;
      });
    }

    // Footer
    line(35, 38, pageWidth - 35, 38, [0.85, 0.88, 0.92]);
    text(38, 25, `${input.businessName} - Computer Generated Deposit & Withdrawal Statement`, 7.5, false, [0.5, 0.55, 0.6]);

    pageStreams.push(ops.join('\n'));
  });

  return assemblePdfDocument(pageStreams, pageWidth, pageHeight);
}

export function buildAllUsersSummaryPdf(input: AllUsersSummaryPdfInput): Buffer {
  const pageWidth = 595.28; // A4 width in points
  const pageHeight = 841.89; // A4 height in points
  const rowsPerFirstPage = 24;
  const rowsPerNextPage = 32;

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
    const ops: string[] = [];
    let y = pageHeight - 45;

    const text = (x: number, yPos: number, str: string, size = 9, bold = false, rgb: [number, number, number] = [0.1, 0.14, 0.2]) => {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} rg`);
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${yPos.toFixed(2)} Td (${pdfEscape(str)}) Tj ET`);
    };

    const rectFill = (x: number, yPos: number, w: number, h: number, rgb: [number, number, number]) => {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} rg`);
      ops.push(`${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    };

    const line = (x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.85, 0.88, 0.92]) => {
      ops.push(`${rgb[0].toFixed(2)} ${rgb[1].toFixed(2)} ${rgb[2].toFixed(2)} RG 0.6 w`);
      ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    };

    // Top Header Banner
    rectFill(35, y - 28, pageWidth - 70, 42, [0.18, 0.22, 0.56]);
    text(48, y - 4, input.businessName.toUpperCase(), 13, true, [1, 1, 1]);
    text(
      48,
      y - 19,
      `ALL USERS DEPOSIT & WITHDRAWAL SUMMARY REPORT (${input.rows.length} USERS)`,
      9.5,
      false,
      [0.88, 0.91, 1],
    );
    text(pageWidth - 115, y - 12, `Page ${pageIndex + 1} of ${pages.length}`, 9, true, [1, 1, 1]);
    y -= 44;

    if (pageIndex === 0) {
      text(38, y, `Generated on: ${input.generatedDate}`, 8.5, false, [0.35, 0.4, 0.48]);
      y -= 14;

      const boxW = (pageWidth - 70 - 16) / 3;
      const boxH = 44;
      const boxY = y - boxH;

      // Box 1: All Users Total Deposit
      rectFill(35, boxY, boxW, boxH, [0.93, 0.98, 0.95]);
      text(44, boxY + 28, 'TOTAL DEPOSITS (+)', 7.5, true, [0.06, 0.48, 0.3]);
      text(44, boxY + 11, `Rs. ${input.totalDeposit}`, 12, true, [0.04, 0.38, 0.24]);

      // Box 2: All Users Total Withdrawal
      rectFill(35 + boxW + 8, boxY, boxW, boxH, [1, 0.95, 0.95]);
      text(44 + boxW + 8, boxY + 28, 'TOTAL WITHDRAWALS (-)', 7.5, true, [0.7, 0.18, 0.22]);
      text(44 + boxW + 8, boxY + 11, `Rs. ${input.totalWithdrawal}`, 12, true, [0.55, 0.12, 0.16]);

      // Box 3: Net Balance Across All Users
      rectFill(35 + (boxW + 8) * 2, boxY, boxW, boxH, [0.94, 0.96, 1]);
      text(44 + (boxW + 8) * 2, boxY + 28, 'TOTAL NET BALANCE', 7.5, true, [0.22, 0.3, 0.68]);
      text(44 + (boxW + 8) * 2, boxY + 11, `Rs. ${input.totalNetBalance}`, 12, true, [0.1, 0.15, 0.35]);

      y = boxY - 18;
    }

    // Table Header
    const tableHeaderY = y - 18;
    rectFill(35, tableHeaderY, pageWidth - 70, 20, [0.93, 0.95, 0.97]);
    text(40, tableHeaderY + 6, 'CODE', 8, true, [0.25, 0.3, 0.38]);
    text(105, tableHeaderY + 6, 'USER NAME', 8, true, [0.25, 0.3, 0.38]);
    text(230, tableHeaderY + 6, 'LOGIN ID', 8, true, [0.25, 0.3, 0.38]);
    text(310, tableHeaderY + 6, 'DEPOSIT (+)', 8, true, [0.25, 0.3, 0.38]);
    text(390, tableHeaderY + 6, 'WITHDRAW (-)', 8, true, [0.25, 0.3, 0.38]);
    text(470, tableHeaderY + 6, 'NET BALANCE', 8, true, [0.25, 0.3, 0.38]);
    y = tableHeaderY;

    if (pageRows.length === 0) {
      text(40, y - 22, 'No users found.', 9, false, [0.45, 0.5, 0.56]);
    } else {
      pageRows.forEach((row, idx) => {
        const rowH = 19;
        const rowY = y - rowH;
        if (idx % 2 === 1) {
          rectFill(35, rowY, pageWidth - 70, rowH, [0.98, 0.99, 1]);
        }
        line(35, rowY, pageWidth - 35, rowY, [0.9, 0.92, 0.95]);

        text(40, rowY + 6, row.accountCode, 8, false, [0.35, 0.4, 0.48]);
        text(105, rowY + 6, truncate(row.name, 22), 8.5, true, [0.1, 0.14, 0.2]);
        text(230, rowY + 6, truncate(row.username || row.name, 14), 8, false, [0.35, 0.4, 0.48]);
        text(310, rowY + 6, `+ ${row.totalDeposit}`, 8, true, [0.06, 0.48, 0.3]);
        text(390, rowY + 6, `- ${row.totalWithdrawal}`, 8, true, [0.7, 0.18, 0.22]);
        text(470, rowY + 6, `Rs. ${row.netBalance}`, 8.5, true, [0.1, 0.14, 0.2]);

        y = rowY;
      });
    }

    line(35, 38, pageWidth - 35, 38, [0.85, 0.88, 0.92]);
    text(38, 25, `${input.businessName} - All Users Deposit & Withdrawal Summary Report`, 7.5, false, [0.5, 0.55, 0.6]);

    pageStreams.push(ops.join('\n'));
  });

  return assemblePdfDocument(pageStreams, pageWidth, pageHeight);
}
