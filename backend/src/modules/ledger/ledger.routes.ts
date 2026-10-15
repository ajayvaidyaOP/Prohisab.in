import { Router } from 'express';
import { validate, getQuery } from '../../middleware/validate.ts';
import { idParam } from '../../lib/schemas.ts';
import { ledgerQuery, statementQuery, type LedgerQuery, type StatementQuery } from './ledger.schemas.ts';
import * as ledger from './ledger.service.ts';

/** Mounted under /api/accounts. */
export const ledgerRouter = Router();

ledgerRouter.get('/:id/ledger', validate(idParam, 'params'), validate(ledgerQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  res.json(await ledger.getLedgerPage(Number(id), getQuery<LedgerQuery>(req)));
});

ledgerRouter.get('/:id/statement', validate(idParam, 'params'), validate(statementQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  res.json(await ledger.getStatement(Number(id), getQuery<StatementQuery>(req)));
});

ledgerRouter.get('/:id/ledger.csv', validate(idParam, 'params'), validate(statementQuery, 'query'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const file = await ledger.getLedgerCsv(Number(id), getQuery<StatementQuery>(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
});
