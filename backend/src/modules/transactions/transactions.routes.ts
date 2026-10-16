import { Router } from 'express';
import { requireAdminRole } from '../../middleware/auth.ts';
import { validate, getQuery } from '../../middleware/validate.ts';
import { errors } from '../../lib/errors.ts';
import { readIdempotencyKey } from '../../lib/idempotency.ts';
import { idParam } from '../../lib/schemas.ts';
import { createTransactionBody, rejectBody, reverseBody, transactionsQuery, type CreateTransactionBody, type RejectBody, type ReverseBody, type TransactionsQuery } from './transactions.schemas.ts';
import * as service from './transactions.service.ts';

export const transactionsRouter = Router();

transactionsRouter.get('/', validate(transactionsQuery, 'query'), async (req, res) => {
  const query = getQuery<TransactionsQuery>(req);
  if (req.admin?.role === 'USER') {
    if (!req.admin.accountId) throw errors.forbidden('No ledger account is linked to this user.');
    res.json(await service.listTransactions({ ...query, accountId: req.admin.accountId }));
    return;
  }
  res.json(await service.listTransactions(query));
});

transactionsRouter.post('/', validate(createTransactionBody), async (req, res) => {
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const body = req.body as CreateTransactionBody;
  if (req.admin?.role === 'USER') {
    if (!req.admin.accountId || body.accountId !== req.admin.accountId) {
      throw errors.forbidden('You can only add entries to your own ledger.');
    }
    const allowedUserTypes = ['CREDIT_PURCHASE', 'CREDIT_SALE', 'PAYMENT_MADE', 'PAYMENT_RECEIVED'];
    if (!allowedUserTypes.includes(body.type)) {
      throw errors.forbidden('Users can only submit Deposit or Withdrawal requests.');
    }
  }
  const result = await service.createTransaction(body, req.admin!.id, key, req.admin?.role ?? 'ADMIN');
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});

transactionsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const transaction = await service.getTransaction(Number(id));
  if (req.admin?.role === 'USER' && transaction.account.id !== req.admin.accountId) {
    throw errors.forbidden('You can only view your own transactions.');
  }
  res.json({ transaction });
});

transactionsRouter.post('/:id/approve', requireAdminRole, validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const result = await service.approveTransaction(Number(id), req.admin!.id, key);
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});

transactionsRouter.post('/:id/reject', requireAdminRole, validate(idParam, 'params'), validate(rejectBody), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const result = await service.rejectTransaction(Number(id), req.body as RejectBody, req.admin!.id, key);
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});

transactionsRouter.post('/:id/reversal', requireAdminRole, validate(idParam, 'params'), validate(reverseBody), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const result = await service.reverseTransaction(Number(id), req.body as ReverseBody, req.admin!.id, key);
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});
