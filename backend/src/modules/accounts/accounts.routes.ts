import { Router } from 'express';
import { validate, getQuery } from '../../middleware/validate.ts';
import { readIdempotencyKey, withIdempotency } from '../../lib/idempotency.ts';
import { idParam } from '../../lib/schemas.ts';
import {
  accountCreateBody,
  accountListQuery,
  accountOptionsQuery,
  accountStatusBody,
  accountUpdateBody,
  type AccountCreateBody,
  type AccountListQuery,
  type AccountOptionsQuery,
  type AccountUpdateBody,
} from './accounts.schemas.ts';
import * as service from './accounts.service.ts';

export const accountsRouter = Router();

accountsRouter.get('/', validate(accountListQuery, 'query'), async (req, res) => {
  res.json(await service.listAccounts(getQuery<AccountListQuery>(req)));
});

accountsRouter.get('/options', validate(accountOptionsQuery, 'query'), async (req, res) => {
  res.json({ items: await service.accountOptions(getQuery<AccountOptionsQuery>(req)) });
});

accountsRouter.post('/', validate(accountCreateBody), async (req, res) => {
  const key = readIdempotencyKey(req.get('Idempotency-Key'));
  const body = req.body as AccountCreateBody;
  const result = await withIdempotency({
    scope: 'POST /api/accounts',
    key,
    payload: body,
    work: async (tx) => {
      const account = await service.createAccountInTx(tx, body, req.admin!.id);
      return { status: 201, body: { account } };
    },
  });
  res.status(result.status).json({ ...(result.body as object), replayed: result.replayed });
});

accountsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  res.json({ account: await service.getAccount(Number(id)) });
});

accountsRouter.patch('/:id', validate(idParam, 'params'), validate(accountUpdateBody), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const account = await service.updateAccount(Number(id), req.body as AccountUpdateBody, req.admin!.id);
  res.json({ account });
});

accountsRouter.patch('/:id/status', validate(idParam, 'params'), validate(accountStatusBody), async (req, res) => {
  const { id } = req.params as unknown as { id: number };
  const { isActive } = req.body as { isActive: boolean };
  const account = await service.setAccountStatus(Number(id), isActive, req.admin!.id);
  res.json({ account });
});
