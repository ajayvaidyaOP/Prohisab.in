import { Router } from 'express';
import { validate, getQuery } from '../../middleware/validate.ts';
import { readIdempotencyKey } from '../../lib/idempotency.ts';
import { idParam } from '../../lib/schemas.ts';
import { createTransactionBody, reverseBody, transactionsQuery, type CreateTransactionBody, type ReverseBody, type TransactionsQuery } from './transactions.schemas.ts';
import * as service from './transactions.service.ts';

export const transactionsRouter = Router();

transactionsRouter.get('/', validate(transactionsQuery, 'query'), async (req, res) => {
  res.json(await service.listTransactions(getQuery<TransactionsQuery>(req)));
});

transactionsRouter.post('/', validate(createTransactionBody), async (req, res) => {
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const result = await service.createTransaction(req.body as CreateTransactionBody, req.admin!.id, key);
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});

transactionsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  res.json({ transaction: await service.getTransaction(Number(id)) });
});

transactionsRouter.post('/:id/reversal', validate(idParam, 'params'), validate(reverseBody), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const result = await service.reverseTransaction(Number(id), req.body as ReverseBody, req.admin!.id, key);
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});
