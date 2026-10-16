import { Router, type Request } from 'express';
import { requireAdminRole } from '../../middleware/auth.ts';
import { validate, getQuery } from '../../middleware/validate.ts';
import { errors } from '../../lib/errors.ts';
import { idParam } from '../../lib/schemas.ts';
import { ledgerQuery, statementQuery, type LedgerQuery, type StatementQuery } from './ledger.schemas.ts';
import * as ledger from './ledger.service.ts';

/** Mounted under /api/accounts. */
export const ledgerRouter = Router();

function ensureCanAccessAccount(req: Request, accountId: number): void {
  if (req.admin?.role === 'ADMIN') return;
  if (req.admin?.role === 'USER' && req.admin.accountId === accountId) return;
  throw errors.forbidden('You can only view your own ledger.');
}

ledgerRouter.get('/:id/ledger', validate(idParam, 'params'), validate(ledgerQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  ensureCanAccessAccount(req, Number(id));
  res.json(await ledger.getLedgerPage(Number(id), getQuery<LedgerQuery>(req)));
});

ledgerRouter.get('/:id/statement', requireAdminRole, validate(idParam, 'params'), validate(statementQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  res.json(await ledger.getStatement(Number(id), getQuery<StatementQuery>(req)));
});

ledgerRouter.get('/:id/ledger.csv', requireAdminRole, validate(idParam, 'params'), validate(statementQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const file = await ledger.getLedgerCsv(Number(id), getQuery<StatementQuery>(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
});

ledgerRouter.get('/:id/ledger.pdf', requireAdminRole, validate(idParam, 'params'), validate(statementQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const file = await ledger.getLedgerPdf(Number(id), getQuery<StatementQuery>(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
});
