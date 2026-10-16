import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.ts';
import type { AccountType } from '../../generated/prisma/client.ts';
import { prisma, type Tx } from '../../db/prisma.ts';
import { errors } from '../../lib/errors.ts';
import { writeAudit } from '../../lib/audit.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { hashPassword } from '../../lib/password.ts';
import { NORMAL_SIDE_BY_ACCOUNT_TYPE } from '../ledger/ledger.rules.ts';
import { loadBalances } from '../ledger/ledger.queries.ts';
import { accountCodeFor, serializeAccount } from './accounts.serializers.ts';
import type { AccountCreateBody, AccountListQuery, AccountOptionsQuery, AccountUpdateBody } from './accounts.schemas.ts';

const accountInclude = {
  loginUser: { select: { id: true, username: true } },
} satisfies Prisma.AccountInclude;

type AccountWithLogin = Prisma.AccountGetPayload<{ include: typeof accountInclude }>;

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
            { loginUser: { username: { contains: term } } },
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
      include: accountInclude,
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
      ...(term
        ? {
            OR: [
              { name: { contains: term } },
              { accountCode: { contains: term } },
              { loginUser: { username: { contains: term } } },
            ],
          }
        : {}),
    },
    include: accountInclude,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: query.limit,
  });
  const info = await loadBalances(prisma, rows.map((row) => row.id));
  return rows.map((row) => serializeAccount(row, info.get(row.id)));
}

export async function getAccount(id: number) {
  const account = await prisma.account.findUnique({ where: { id }, include: accountInclude });
  if (!account) throw errors.notFound('Account not found.');
  const info = await loadBalances(prisma, [id]);
  return serializeAccount(account, info.get(id));
}

async function findAccountOrThrow(tx: Tx, id: number): Promise<AccountWithLogin> {
  const account = await tx.account.findUnique({ where: { id }, include: accountInclude });
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
  const loginUsername = input.password ? (input.username?.trim() || input.name.trim()) : input.username?.trim();

  if (loginUsername) {
    const taken = await tx.adminUser.findUnique({ where: { username: loginUsername }, select: { id: true } });
    if (taken) {
      throw errors.conflict(
        'DUPLICATE_USERNAME',
        `User "${loginUsername}" already exists. Choose a different name.`,
        [{ field: 'name', message: 'A user with this name already exists.' }],
      );
    }
  }

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

  if (loginUsername && input.password) {
    const passwordHash = await hashPassword(input.password);
    await tx.adminUser.create({
      data: {
        username: loginUsername,
        passwordHash,
        role: 'USER',
        accountId: created.id,
      },
    });
  }

  const account = await tx.account.update({
    where: { id: created.id },
    data: { accountCode: accountCodeFor(input.type, created.id) },
    include: accountInclude,
  });

  await writeAudit(tx, {
    action: 'ACCOUNT_CREATED',
    entityType: 'Account',
    entityId: account.id,
    actorId,
    details: {
      accountCode: account.accountCode,
      name: account.name,
      username: account.loginUser?.username ?? null,
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

    if (patch.username && patch.username !== before.loginUser?.username) {
      const taken = await tx.adminUser.findUnique({ where: { username: patch.username }, select: { id: true } });
      if (taken && taken.id !== before.loginUser?.id) {
        throw errors.conflict(
          'DUPLICATE_USERNAME',
          `Username "${patch.username}" is already taken. Choose another username.`,
          [{ field: 'username', message: 'Username is already taken.' }],
        );
      }
    }

    if (before.loginUser) {
      const loginUpdate: Prisma.AdminUserUpdateInput = {};
      if (patch.username && patch.username !== before.loginUser.username) {
        loginUpdate.username = patch.username;
      }
      if (patch.password) {
        loginUpdate.passwordHash = await hashPassword(patch.password);
        await tx.session.deleteMany({ where: { adminUserId: before.loginUser.id } });
      }
      if (Object.keys(loginUpdate).length > 0) {
        await tx.adminUser.update({
          where: { id: before.loginUser.id },
          data: loginUpdate,
        });
      }
    } else if (patch.username || patch.password) {
      if (!patch.username) {
        throw errors.badRequest('Enter a username to create login credentials for this user.', [
          { field: 'username', message: 'Username is required.' },
        ]);
      }
      if (!patch.password) {
        throw errors.badRequest('Enter a password to create login credentials for this user.', [
          { field: 'password', message: 'Password is required.' },
        ]);
      }
      const passwordHash = await hashPassword(patch.password);
      await tx.adminUser.create({
        data: {
          username: patch.username,
          passwordHash,
          role: 'USER',
          accountId: id,
        },
      });
    }

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

    const after = await tx.account.update({ where: { id }, data, include: accountInclude });

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of EDITABLE_FIELDS) {
      const oldValue = display(before[field]);
      const newValue = display(after[field]);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[field] = { from: oldValue, to: newValue };
      }
    }
    if (before.loginUser?.username !== after.loginUser?.username) {
      changes.username = { from: before.loginUser?.username ?? null, to: after.loginUser?.username ?? null };
    }
    if (patch.password) {
      changes.password = { from: '***', to: '*** (updated)' };
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
    const after = await tx.account.update({ where: { id }, data: { isActive }, include: accountInclude });
    if (!isActive && after.loginUser) {
      await tx.session.deleteMany({ where: { adminUserId: after.loginUser.id } });
    }
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
