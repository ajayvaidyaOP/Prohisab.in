import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.ts';
import type { Account, AccountType } from '../../generated/prisma/client.ts';
import { prisma, type Tx } from '../../db/prisma.ts';
import { errors } from '../../lib/errors.ts';
import { writeAudit } from '../../lib/audit.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from '../ledger/ledger.rules.ts';
import { loadBalances } from '../ledger/ledger.queries.ts';
import { accountCodeFor, serializeAccount } from './accounts.serializers.ts';
import type { AccountCreateBody, AccountListQuery, AccountOptionsQuery, AccountUpdateBody } from './accounts.schemas.ts';

/** Strips LIKE wildcards so user search text is matched literally. */
function searchTerm(raw: string): string {
  return raw.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function listAccounts(query: AccountListQuery) {
  const term = query.search ? searchTerm(query.search) : '';
  const where: Prisma.AccountWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status === 'active' ? { isActive: true } : {}),
    ...(query.status === 'inactive' ? { isActive: false } : {}),
    ...(term
      ? {
          OR: [
            { name: { contains: term } },
            { accountCode: { contains: term } },
            { phone: { contains: term } },
            { email: { contains: term } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.AccountOrderByWithRelationInput[] =
    query.sort === 'code'
      ? [{ accountCode: 'asc' }]
      : query.sort === 'newest'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ name: 'asc' }, { id: 'asc' }];

  const [total, rows] = await Promise.all([
    prisma.account.count({ where }),
    prisma.account.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const info = await loadBalances(prisma, rows.map((row) => row.id));

  return {
    items: rows.map((row) => serializeAccount(row, info.get(row.id))),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function accountOptions(query: AccountOptionsQuery) {
  const term = query.search ? searchTerm(query.search) : '';
  const rows = await prisma.account.findMany({
    where: {
      isActive: true,
      ...(query.type ? { type: query.type } : {}),
      ...(term ? { OR: [{ name: { contains: term } }, { accountCode: { contains: term } }] } : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: query.limit,
  });
  const info = await loadBalances(prisma, rows.map((row) => row.id));
  return rows.map((row) => serializeAccount(row, info.get(row.id)));
}

export async function getAccount(id: number) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) throw errors.notFound('Account not found.');
  const info = await loadBalances(prisma, [id]);
  return serializeAccount(account, info.get(id));
}

async function findAccountOrThrow(tx: Tx, id: number): Promise<Account> {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account) throw errors.notFound('Account not found.');
  return account;
}

/** Locks the account row for the duration of the transaction (serializes writes per account). */
export async function lockAccount(tx: Tx, id: number): Promise<{ id: number; type: AccountType; isActive: boolean }> {
  const rows = await tx.$queryRaw<Array<{ id: number; type: AccountType; isActive: number | boolean }>>`
    SELECT id, type, isActive FROM Account WHERE id = ${id} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw errors.notFound('Account not found.');
  return { id: row.id, type: row.type, isActive: Boolean(row.isActive) };
}

function ensureOpeningSide(type: AccountType, requested: 'RECEIVABLE' | 'PAYABLE' | undefined): void {
  const normal = NORMAL_SIDE_BY_ACCOUNT_TYPE[type];
  if (requested && requested !== normal) {
    const message =
      type === 'CUSTOMER'
        ? 'A customer’s opening balance must be a receivable (money owed by the customer).'
        : 'A supplier’s opening balance must be a payable (money the business owes the supplier).';
    throw errors.unprocessable('OPENING_SIDE_MISMATCH', message, [{ field: 'openingBalanceSide', message }]);
  }
}

export async function createAccountInTx(tx: Tx, input: AccountCreateBody, actorId: number) {
  ensureOpeningSide(input.type, input.openingBalanceSide);
  const side = NORMAL_SIDE_BY_ACCOUNT_TYPE[input.type];

  // Insert with a unique temporary code, then derive the final code from the generated id.
  // This keeps code generation race-free without a separate counter table.
  const created = await tx.account.create({
    data: {
      accountCode: `TMP-${randomBytes(8).toString('hex')}`,
      name: input.name,
      type: input.type,
      phone: input.phone,
      email: input.email,
      address: input.address,
      notes: input.notes,
      openingBalance: input.openingBalance,
      openingBalanceSide: side,
      isActive: true,
    },
  });
  const account = await tx.account.update({
    where: { id: created.id },
    data: { accountCode: accountCodeFor(input.type, created.id) },
  });
  await writeAudit(tx, {
    action: 'ACCOUNT_CREATED',
    entityType: 'Account',
    entityId: account.id,
    actorId,
    details: {
      accountCode: account.accountCode,
      name: account.name,
      type: account.type,
      openingBalance: formatMoney(account.openingBalance),
      openingBalanceSide: account.openingBalanceSide,
    },
  });
  const info = await loadBalances(tx, [account.id]);
  return serializeAccount(account, info.get(account.id));
}

export async function createAccount(input: AccountCreateBody, actorId: number) {
  return prisma.$transaction((tx) => createAccountInTx(tx, input, actorId));
}

const EDITABLE_FIELDS = ['name', 'type', 'phone', 'email', 'address', 'notes', 'openingBalance', 'openingBalanceSide'] as const;

function display(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return formatMoney(value);
  return value ?? null;
}

export async function updateAccount(id: number, patch: AccountUpdateBody, actorId: number) {
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, id);
    const before = await findAccountOrThrow(tx, id);
    const entryCount = await tx.ledgerEntry.count({ where: { accountId: id } });

    if (patch.type && patch.type !== before.type && entryCount > 0) {
      throw errors.unprocessable(
        'ACCOUNT_TYPE_LOCKED',
        'This account already has transactions, so its type can no longer be changed. Create a new account instead.',
        [{ field: 'type', message: 'Type is locked after the first transaction.' }],
      );
    }

    if (patch.openingBalance !== undefined && entryCount > 0 && !money(patch.openingBalance).equals(before.openingBalance)) {
      throw errors.unprocessable(
        'OPENING_BALANCE_LOCKED',
        'The opening balance cannot be changed after transactions exist. Post an adjustment transaction instead.',
        [{ field: 'openingBalance', message: 'Locked after the first transaction.' }],
      );
    }

    const nextType = patch.type ?? before.type;
    ensureOpeningSide(nextType, patch.openingBalanceSide);

    const data: Prisma.AccountUpdateInput = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.address !== undefined ? { address: patch.address } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.openingBalance !== undefined ? { openingBalance: patch.openingBalance } : {}),
      openingBalanceSide: NORMAL_SIDE_BY_ACCOUNT_TYPE[nextType],
    };

    const after = await tx.account.update({ where: { id }, data });

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of EDITABLE_FIELDS) {
      const oldValue = display(before[field]);
      const newValue = display(after[field]);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[field] = { from: oldValue, to: newValue };
      }
    }
    if (Object.keys(changes).length > 0) {
      await writeAudit(tx, {
        action: 'ACCOUNT_UPDATED',
        entityType: 'Account',
        entityId: id,
        actorId,
        details: { accountCode: after.accountCode, changes, hadTransactions: entryCount > 0 },
      });
    }

    const info = await loadBalances(tx, [id]);
    return serializeAccount(after, info.get(id));
  });
}

export async function setAccountStatus(id: number, isActive: boolean, actorId: number) {
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, id);
    const before = await findAccountOrThrow(tx, id);
    if (before.isActive === isActive) {
      const info = await loadBalances(tx, [id]);
      return serializeAccount(before, info.get(id));
    }
    const after = await tx.account.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, {
      action: isActive ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_DEACTIVATED',
      entityType: 'Account',
      entityId: id,
      actorId,
      details: { accountCode: after.accountCode, name: after.name },
    });
    const info = await loadBalances(tx, [id]);
    return serializeAccount(after, info.get(id));
  });
}

