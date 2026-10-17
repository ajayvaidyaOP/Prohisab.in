import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.ts';
import { audit } from '../lib/audit.ts';
import { dateRange, id, nullableString, num, pagination, paging, parse, textParam, dateParam } from '../lib/validation.ts';
import { errors } from '../lib/errors.ts';
import { formatMoney, money, parseMoneyInput } from '../lib/money.ts';
import { dbDateToIso, isoDateToDbDate, isValidIsoDate } from '../lib/dates.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { buildMultiReportPdf } from '../lib/pdf.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { summary } from '../services/accounts.ts';
import { combinedReport, type ReportWhere } from '../services/reports.ts';
import { businessToday, businessView } from '../services/settings.ts';
import { checkPostingDate, insertEntry, loadTransaction, lockEntry, parseKind, serializeTransaction, transactionInclude, transactionTotals, validateBook, validateOption } from '../services/transactions.ts';

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

function filters(query: Record<string, unknown>): Prisma.TransactionWhereInput {
  const range = dateRange(query);
  const approvalStatus = textParam(query.approvalStatus)?.toUpperCase();
  if (approvalStatus && !['PENDING', 'APPROVED', 'REJECTED'].includes(approvalStatus)) {
    throw errors.badRequest('Invalid approval status.');
  }
  const type = textParam(query.type)?.toUpperCase();
  const bookId = textParam(query.bookId);
  const accountId = textParam(query.accountId);
  const search = textParam(query.search)?.slice(0, 150);
  return {
    user: { role: 'USER' },
    ...(accountId ? { userId: id(accountId, 'accountId') } : {}),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(type && type !== 'REVERSAL' ? { kind: parseKind(type) } : {}),
    ...(bookId ? { bookId: id(bookId, 'bookId') } : {}),
    ...(type === 'REVERSAL' ? { AND: [{ reversalOfId: { not: null } }] } : {}),
    ...(query.includeReversals === 'false' ? { reversalOfId: null } : {}),
    ...(range.where ? { entryDate: range.where } : {}),
    ...(search ? { OR: [{ optionName: { contains: search } }, { detail: { contains: search } },
      { referenceNumber: { contains: search } }, { customerId: { contains: search } },
      { bankDetails: { contains: search } }, { book: { name: { contains: search } } }, { user: { name: { contains: search } } }] } : {}),
  };
}
transactionsRouter.get('/', requireAdmin, async (req, res) => {
  const { page, pageSize, skip } = paging(req.query, 25);
  const where = filters(req.query);
  const [items, total, summary] = await Promise.all([
    prisma.transaction.findMany({ where, include: transactionInclude,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], skip, take: pageSize }),
    prisma.transaction.count({ where }),
    transactionTotals(where),
  ]);
  res.json({ items: items.map(serializeTransaction), pagination: pagination(page, pageSize, total), summary });
});

function multiFilters(query: Record<string, unknown>): ReportWhere {
  const range = dateRange(query);
  const rawIds = textParam(query.userIds);
  const ids = rawIds ? [...new Set(rawIds.split(',').map((value) => id(value.trim(), 'userIds')))] : [];
  if (ids.length > 500) throw errors.badRequest('Too many selected users.');
  const bookId = textParam(query.bookId);
  return { user: { role: 'USER' }, ...(ids.length ? { userId: { in: ids } } : {}),
    ...(bookId ? { bookId: id(bookId, 'bookId') } : {}), ...(range.where ? { entryDate: range.where } : {}) };
}
transactionsRouter.get('/multi-report', requireAdmin, async (req, res) => {
  if (req.query.summary === 'true') {
    res.json(await combinedReport(multiFilters(req.query)));
    return;
  }
  const rows = await prisma.transaction.findMany({ where: multiFilters(req.query), include: transactionInclude,
    orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], take: 10_001 });
  if (rows.length > 10_000) throw errors.badRequest('Too many entries for one report. Narrow the date range.');
  res.json(rows.map(serializeTransaction));
});
transactionsRouter.get('/multi-report.pdf', requireAdmin, async (req, res) => {
  const report = await combinedReport(multiFilters(req.query));
  const business = await businessView(prisma);
  const bookId = textParam(req.query.bookId);
  const book = bookId ? await prisma.book.findUnique({ where: { id: id(bookId, 'bookId') } }) : null;
  const pdf = buildMultiReportPdf({ businessName: business.businessName, generatedDate: await businessToday(),
    title: 'COMBINED STAFF COLLECTION REPORT',
    summaryLine: `Approved collection: ${report.summary.deposits} | Withdrawals: ${report.summary.withdrawals} | Period net: ${report.summary.net}`,
    filterLine: `Pending: ${report.summary.pendingEntries} / ${report.summary.pendingAmount} | Rejected: ${report.summary.rejectedEntries} (excluded) | ${book?.name ?? 'All books'} | Staff: ${report.staffSummary.map((row) => row.name).join(', ')}`,
    comparisons: [
      { title: 'STAFF-WISE SUMMARY', rows: report.staffSummary.map((row) => ({ ...row, label: row.name })) },
      { title: 'BOOK-WISE SUMMARY', rows: report.bookSummary.map((row) => ({ ...row, label: row.name })) },
    ],
    fromDate: textParam(req.query.from) ?? null, toDate: textParam(req.query.to) ?? null,
    rows: report.rows.map((entry) => ({ entryDate: entry.entryDate,
      staff: entry.account.name, book: entry.bookName ?? 'No book assigned',
      type: `${entry.direction === 'INCREASE' ? '+' : '-'} ${entry.typeLabel}`, amount: entry.amount,
      status: entry.approvalStatus, description: entry.description,
      customerId: entry.customerId ?? '-', bankDetails: entry.bankDetails ?? '-',
    })),
  });
  res.type('application/pdf').attachment('multi-user-history.pdf').send(pdf);
});

// Uses exactly the same filters as the entries list, without its page limit.
transactionsRouter.get('/report.pdf', requireAdmin, async (req, res) => {
  const where = filters(req.query);
  const rows = await prisma.transaction.findMany({ where, include: transactionInclude,
    orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], take: 10_001 });
  if (rows.length > 10_000) throw errors.badRequest('Too many entries for one report. Narrow the date range.');
  const totals = await transactionTotals(where);
  const business = await businessView(prisma);
  const book = textParam(req.query.bookId) ? await prisma.book.findUnique({ where: { id: id(req.query.bookId, 'bookId') } }) : null;
  const user = textParam(req.query.accountId) ? await prisma.user.findUnique({ where: { id: id(req.query.accountId, 'accountId') } }) : null;
  const pdf = buildMultiReportPdf({ businessName: business.businessName, generatedDate: await businessToday(),
    title: 'ENTRIES & COLLECTION REPORT',
    summaryLine: `Approved collection: ${totals.deposits} | Withdrawals: ${totals.withdrawals} | Net: ${totals.net} | Approved entries: ${totals.approvedEntries}`,
    filterLine: `${book?.name ?? 'All books'} | ${user?.name ?? 'All users'} | ${textParam(req.query.type) ?? 'All types'} | ${textParam(req.query.approvalStatus) ?? 'All statuses'} | Search: ${textParam(req.query.search) ?? '-'} | Reversals: ${req.query.includeReversals === 'false' ? 'hidden' : 'included'}`,
    fromDate: textParam(req.query.from) ?? null, toDate: textParam(req.query.to) ?? null,
    rows: rows.map(serializeTransaction).map((entry) => ({ entryDate: entry.entryDate,
      staff: entry.account.name, book: entry.bookName ?? 'No book assigned',
      type: `${entry.direction === 'INCREASE' ? '+' : '-'} ${entry.typeLabel}`, amount: entry.amount,
      status: entry.approvalStatus, description: entry.description,
      customerId: entry.customerId ?? '-', bankDetails: entry.bankDetails ?? '-',
    })),
  });
  res.type('application/pdf').attachment('entries-collection.pdf').send(pdf);
});

transactionsRouter.get('/:id', async (req, res) => {
  const row = await loadTransaction(prisma, id(req.params.id));
  if (actor(req).role !== 'ADMIN' && row.userId !== actor(req).id) throw errors.notFound('Transaction not found.');
  res.json(serializeTransaction(row));
});

const createSchema = z.object({
  accountId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  type: z.string().min(1), entryDate: z.string().refine(isValidIsoDate, 'Enter a valid YYYY-MM-DD date.'),
  amount: z.union([z.string(), z.number()]),
  optionName: z.string().max(120).nullish(), option: z.string().max(120).nullish(),
  detail: z.string().max(500).nullish(), description: z.string().max(500).nullish(),
  notes: z.string().max(500).nullish(), paymentMethod: z.string().max(20).nullish(),
  referenceNumber: z.string().max(100).nullish(), bookId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish(),
  customerId: z.string().max(60).nullish(), bankDetails: z.string().max(255).nullish(),
});
transactionsRouter.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const targetId = id(body.accountId, 'accountId');
  const viewer = actor(req);
  if (viewer.role === 'USER' && viewer.id !== targetId) throw errors.forbidden('You can only add entries to your own account.');
  const kind = parseKind(body.type);
  let amount: string;
  try { amount = parseMoneyInput(body.amount); } catch (error) {
    throw errors.badRequest(error instanceof Error ? error.message : 'Invalid amount.', [{ field: 'amount', message: 'Enter an amount with up to 2 decimals.' }]);
  }
  if (!money(amount).gt(0)) throw errors.badRequest('Amount must be greater than zero.', [{ field: 'amount', message: 'Enter a positive amount.' }]);
  const notes = nullableString(body.notes);
  const separator = notes?.match(/\s+[—-]\s+/);
  const optionRaw = nullableString(body.optionName ?? body.option) ??
    (separator && notes ? notes.slice(0, separator.index).trim() : notes);
  const detail = nullableString(body.detail ?? body.description) ??
    (separator && notes ? notes.slice((separator.index ?? 0) + separator[0].length) : null);
  if (!optionRaw) throw errors.unprocessable('INVALID_ENTRY_OPTION', 'Select an entry option.', [{ field: 'optionName', message: 'Select an option.' }]);
  const input = { accountId: targetId, kind, entryDate: body.entryDate, amount, optionName: optionRaw,
    detail, paymentMethod: body.paymentMethod, referenceNumber: body.referenceNumber,
    bookId: body.bookId ? id(body.bookId, 'bookId') : null,
    customerId: body.customerId, bankDetails: body.bankDetails };
  const today = await businessToday();
  const result = await withIdempotency('POST /api/transactions', viewer.id, req.get('Idempotency-Key') || undefined,
    { ...input, accountId: String(targetId), bookId: input.bookId?.toString() ?? null }, async (tx) => {
      const row = await insertEntry(tx, input, viewer.id, viewer.role, today);
      return { status: 201, body: { transaction: serializeTransaction(row), account: await summary(tx, targetId) } };
    });
  res.status(result.status).json(result.body);
});

/** How long after creation the entry's author may still edit it. */
const EDIT_WINDOW_MS = 60 * 60_000;

const editSchema = z.object({
  type: z.string().min(1).optional(),
  entryDate: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  optionName: z.string().max(120).nullish(), option: z.string().max(120).nullish(),
  detail: z.string().max(500).nullish(), description: z.string().max(500).nullish(),
  paymentMethod: z.string().max(20).nullish(), referenceNumber: z.string().max(100).nullish(),
  bookId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish(),
  customerId: z.string().max(60).nullish(), bankDetails: z.string().max(255).nullish(),
});
/**
 * Edit an own entry within 1 hour of creation (admins may edit any entry).
 * Only pending/approved entries that are not reversals and not yet reversed can be edited;
 * money columns are recalculated from the ledger rows, so an edit stays consistent everywhere.
 */
transactionsRouter.patch('/:id', async (req, res) => {
  const entryId = id(req.params.id);
  const viewer = actor(req);
  const body = parse(editSchema, req.body);
  const today = await businessToday();
  const result = await withIdempotency(`PATCH /api/transactions/${entryId}`, viewer.id,
    req.get('Idempotency-Key') || undefined, { entryId: String(entryId) }, async (tx) => {
      const current = await loadTransaction(tx, entryId);
      if (viewer.role !== 'ADMIN' && current.userId !== viewer.id) throw errors.notFound('Transaction not found.');
      if (current.reversalOfId !== null) throw errors.unprocessable('REVERSAL_ENTRY', 'Reversal entries cannot be edited.');
      if (current.reversedById !== null) throw errors.unprocessable('ALREADY_REVERSED', 'This entry has already been reversed.');
      if (current.approvalStatus === 'REJECTED') throw errors.unprocessable('REJECTED_ENTRY', 'Rejected entries cannot be edited.');
      if (Date.now() - current.createdAt.getTime() > EDIT_WINDOW_MS) {
        throw errors.unprocessable('EDIT_WINDOW_EXPIRED', 'Entries can only be edited for 1 hour after creation.');
      }
      const target = await tx.user.findUniqueOrThrow({ where: { id: current.userId } });
      if (!target.isActive) throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before editing entries.');

      const kind = body.type !== undefined ? parseKind(body.type) : current.kind;
      let amount: Prisma.Decimal | string = current.amount;
      if (body.amount !== undefined) {
        try { amount = parseMoneyInput(body.amount); } catch (error) {
          throw errors.badRequest(error instanceof Error ? error.message : 'Invalid amount.', [{ field: 'amount', message: 'Enter an amount with up to 2 decimals.' }]);
        }
        if (!money(amount).gt(0)) throw errors.badRequest('Amount must be greater than zero.', [{ field: 'amount', message: 'Enter a positive amount.' }]);
      }
      const optionRaw = nullableString(body.optionName ?? body.option) ?? current.optionName;
      const optionName = await validateOption(tx, optionRaw);
      const detail = body.detail !== undefined || body.description !== undefined
        ? nullableString(body.detail ?? body.description) : current.detail;
      const entryDate = dateParam(body.entryDate, 'entryDate') ?? dbDateToIso(current.entryDate);
      if (entryDate !== dbDateToIso(current.entryDate)) {
        checkPostingDate(entryDate, today, 'USER', target.backDateAllowedDate ? dbDateToIso(target.backDateAllowedDate) : null);
      }
      const bookId = body.bookId !== undefined ? (body.bookId ? id(body.bookId, 'bookId') : null) : current.bookId;
      await validateBook(tx, current.userId, bookId, true);

      const updated = await tx.transaction.update({ where: { id: entryId }, data: {
        kind, entryDate: isoDateToDbDate(entryDate), amount, optionName, detail,
        paymentMethod: body.paymentMethod !== undefined
          ? nullableString(body.paymentMethod)?.toUpperCase() ?? null : current.paymentMethod,
        referenceNumber: body.referenceNumber !== undefined ? nullableString(body.referenceNumber) : current.referenceNumber,
        bookId,
        customerId: body.customerId !== undefined ? nullableString(body.customerId) : current.customerId,
        bankDetails: body.bankDetails !== undefined ? nullableString(body.bankDetails) : current.bankDetails,
      }, include: transactionInclude });
      await audit(tx, 'TRANSACTION_EDITED', 'LedgerTransaction', entryId, viewer.id, {
        userId: current.userId, previousAmount: formatMoney(current.amount), amount: formatMoney(amount),
        previousOption: current.optionName, option: optionName,
      });
      return { status: 200, body: { transaction: serializeTransaction(updated), account: await summary(tx, current.userId) } };
    });
  res.status(result.status).json(result.body);
});

transactionsRouter.post('/:id/approve', requireAdmin, async (req, res) => {
  const entryId = id(req.params.id), viewer = actor(req);
  const result = await withIdempotency(`POST /api/transactions/${entryId}/approve`, viewer.id,
    req.get('Idempotency-Key') || undefined, { entryId: String(entryId) }, async (tx) => {
      const row = await lockEntry(tx, entryId);
      if (!row.userId) throw errors.notFound('Transaction not found.');
      const target = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
      if (!target.isActive) throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before approving entries.');
      if (row.approvalStatus === 'REJECTED') throw errors.conflict('ALREADY_REJECTED', 'This entry has already been rejected.');
      if (row.approvalStatus === 'APPROVED') throw errors.conflict('ALREADY_APPROVED', 'This entry has already been approved.');
      await tx.transaction.update({ where: { id: entryId }, data: {
        approvalStatus: 'APPROVED', reviewedById: viewer.id, reviewedAt: new Date(), rejectionReason: null,
      } });
      await audit(tx, 'TRANSACTION_APPROVED', 'LedgerTransaction', entryId, viewer.id,
        { userId: row.userId, amount: formatMoney(row.amount) });
      return { status: 200, body: { transaction: serializeTransaction(await loadTransaction(tx, entryId)),
        account: await summary(tx, row.userId), alreadyApproved: false } };
    });
  res.status(result.status).json(result.body);
});

transactionsRouter.post('/:id/reject', requireAdmin, async (req, res) => {
  const entryId = id(req.params.id), viewer = actor(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(300) }), req.body);
  const result = await withIdempotency(`POST /api/transactions/${entryId}/reject`, viewer.id,
    req.get('Idempotency-Key') || undefined, { entryId: String(entryId), reason }, async (tx) => {
      const row = await lockEntry(tx, entryId);
      if (row.approvalStatus === 'APPROVED') throw errors.conflict('ALREADY_APPROVED', 'This entry has already been approved.');
      if (row.approvalStatus === 'REJECTED') return { status: 200, body: {
        transaction: serializeTransaction(row), account: await summary(tx, row.userId), alreadyRejected: true } };
      await tx.transaction.update({ where: { id: entryId }, data: {
        approvalStatus: 'REJECTED', reviewedById: viewer.id, reviewedAt: new Date(), rejectionReason: reason,
      } });
      await audit(tx, 'TRANSACTION_REJECTED', 'LedgerTransaction', entryId, viewer.id,
        { userId: row.userId, amount: formatMoney(row.amount), reason });
      return { status: 200, body: { transaction: serializeTransaction(await loadTransaction(tx, entryId)),
        account: await summary(tx, row.userId), alreadyRejected: false } };
    });
  res.status(result.status).json(result.body);
});

transactionsRouter.post('/:id/reversal', requireAdmin, async (req, res) => {
  const entryId = id(req.params.id), viewer = actor(req);
  const { reason, entryDate: requested } = parse(z.object({
    reason: z.string().trim().min(1).max(300), entryDate: z.string().optional(),
  }), req.body);
  const today = await businessToday();
  const entryDate = dateParam(requested, 'entryDate') ?? today;
  if (entryDate > today) throw errors.unprocessable('FUTURE_DATE', 'Reversal date cannot be in the future.');
  const result = await withIdempotency(`POST /api/transactions/${entryId}/reversal`, viewer.id,
    req.get('Idempotency-Key') || undefined, { entryId: String(entryId), reason, entryDate }, async (tx) => {
      const original = await lockEntry(tx, entryId);
      if (original.reversalOfId !== null) throw errors.badRequest('Reversal entries cannot be reversed again.');
      if (original.reversedById !== null) throw errors.conflict('ALREADY_REVERSED', 'This entry has already been reversed.');
      if (original.approvalStatus !== 'APPROVED') throw errors.unprocessable('NOT_APPROVED', 'Only approved entries can be reversed.');
      const target = await tx.user.findUniqueOrThrow({ where: { id: original.userId } });
      if (!target.isActive) throw errors.unprocessable('ACCOUNT_INACTIVE', 'This account is inactive. Reactivate it before reversing entries.');
      const reversal = await tx.transaction.create({ data: {
        userId: original.userId, entryDate: isoDateToDbDate(entryDate),
        kind: original.kind === 'DEPOSIT' ? 'WITHDRAWAL' : 'DEPOSIT', amount: original.amount,
        optionName: original.optionName, detail: `Reversal of entry #${entryId} — ${reason}`,
        bookId: original.bookId, customerId: original.customerId, bankDetails: original.bankDetails,
        paymentMethod: original.paymentMethod, referenceNumber: original.referenceNumber,
        reversalOfId: original.id, approvalStatus: 'APPROVED',
        reviewedById: viewer.id, reviewedAt: new Date(), createdById: viewer.id,
      }, include: transactionInclude });
      await tx.transaction.update({ where: { id: entryId }, data: { reversedById: reversal.id } });
      await audit(tx, 'TRANSACTION_REVERSED', 'LedgerTransaction', entryId, viewer.id,
        { reversalId: reversal.id, userId: original.userId, amount: formatMoney(original.amount), reason });
      return { status: 200, body: { reversal: serializeTransaction(reversal),
        original: { id: num(entryId)!, isReversed: true, reversedById: num(reversal.id)! },
        account: await summary(tx, original.userId) } };
    });
  res.status(result.status).json(result.body);
});
