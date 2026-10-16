import { Router } from 'express';
import { buildLedgerPdf } from '../lib/pdf.ts';
import { id, pagination, paging, textParam } from '../lib/validation.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { businessToday, businessView } from '../services/settings.ts';
import { getLedger, ledgerCsv } from '../services/ledger.ts';
import { prisma } from '../db/prisma.ts';

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth);
ledgerRouter.get('/:id/ledger', async (req, res) => {
  const { page, pageSize, skip } = paging(req.query, 25);
  const result = await getLedger(id(req.params.id), req.query, actor(req));
  res.json({ ...result, entries: result.entries.slice(skip, skip + pageSize),
    pagination: pagination(page, pageSize, result.entries.length) });
});
ledgerRouter.get('/:id/statement', async (req, res) => {
  res.json(await getLedger(id(req.params.id), req.query, actor(req)));
});
ledgerRouter.get('/:id/ledger.csv', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const result = await getLedger(userId, req.query, actor(req));
  res.type('text/csv; charset=utf-8').attachment(`ledger-user-${userId}.csv`).send(ledgerCsv(result));
});
ledgerRouter.get('/:id/ledger.pdf', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const query = { ...req.query } as Record<string, unknown>;
  const today = await businessToday();
  const period = textParam(query.period);
  if (period === 'this-month') {
    query.from = `${today.slice(0, 7)}-01`;
    query.to = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  } else if (period === 'last-month') {
    const previous = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
    query.from = previous.toISOString().slice(0, 10);
    query.to = new Date(Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  const result = await getLedger(userId, query, actor(req));
  const business = await businessView(prisma);
  const pdf = buildLedgerPdf({
    businessName: business.businessName, accountName: result.account.name,
    accountCode: result.account.accountCode, fromDate: result.filters.from,
    toDate: result.filters.to, generatedDate: today,
    totalCredited: result.totals.increases, totalSettled: result.totals.decreases,
    // AccountSummary displays the absolute value with a DUE/CREDIT label; the
    // PDF's "Deposit - Withdraw" field needs the signed financial net.
    outstandingBalance: result.closingBalance.status === 'CREDIT'
      ? `-${result.closingBalance.amount}` : result.closingBalance.amount,
    pendingSubmissionsAmount: result.account.pendingSubmissionsAmount,
    rows: result.entries.map((row) => ({ id: row.id, entryDate: row.entryDate,
      description: row.description, paymentMethod: row.paymentMethodLabel ?? '—',
      status: row.approvalStatus, increase: row.approvalStatus === 'APPROVED' && row.direction === 'INCREASE' ? row.amount : '',
      decrease: row.approvalStatus === 'APPROVED' && row.direction === 'DECREASE' ? row.amount : '',
      runningBalance: row.runningBalance })),
  });
  res.type('application/pdf').attachment(`ledger-user-${userId}.pdf`).send(pdf);
});
