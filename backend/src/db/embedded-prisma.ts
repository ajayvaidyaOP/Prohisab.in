import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma } from '../generated/prisma/client.ts';
import type {
  AccountType,
  ApprovalStatus,
  BalanceSide,
  EntryDirection,
  IdempotencyStatus,
  PaymentMethod,
  TransactionType,
  UserRole,
} from '../generated/prisma/client.ts';

interface StoredAdminUser {
  id: number;
  username: string;
  passwordHash: string;
  role: UserRole;
  accountId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredSession {
  id: string;
  adminUserId: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

interface StoredAccount {
  id: number;
  accountCode: string;
  name: string;
  type: AccountType;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingBalance: string;
  openingBalanceSide: BalanceSide;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredLedgerEntry {
  id: number;
  accountId: number;
  entryDate: string;
  type: TransactionType;
  side: BalanceSide;
  direction: EntryDirection;
  amount: string;
  paymentMethod: PaymentMethod | null;
  referenceNumber: string | null;
  notes: string | null;
  reversalOfId: number | null;
  approvalStatus: ApprovalStatus;
  reviewedById: number | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdById: number | null;
  createdAt: string;
}

interface StoredAuditLog {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  actorId: number | null;
  details: unknown;
  createdAt: string;
}

interface StoredIdempotencyKey {
  id: number;
  scope: string;
  keyHash: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: string;
  expiresAt: string;
}

interface StoredAppSetting {
  id: number;
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  currencySymbol: string;
  timezone: string;
  userEntryOptions: string[] | null;
  updatedAt: string;
}

interface StoreData {
  seq: {
    adminUser: number;
    account: number;
    ledgerEntry: number;
    auditLog: number;
    idempotencyKey: number;
  };
  adminUsers: StoredAdminUser[];
  sessions: StoredSession[];
  accounts: StoredAccount[];
  ledgerEntries: StoredLedgerEntry[];
  auditLogs: StoredAuditLog[];
  idempotencyKeys: StoredIdempotencyKey[];
  appSettings: StoredAppSetting[];
}

const DATA_FILE = path.resolve(process.cwd(), '.erp-local-db.json');

function defaultStore(): StoreData {
  return {
    seq: { adminUser: 0, account: 0, ledgerEntry: 0, auditLog: 0, idempotencyKey: 0 },
    adminUsers: [],
    sessions: [],
    accounts: [],
    ledgerEntries: [],
    auditLogs: [],
    idempotencyKeys: [],
    appSettings: [],
  };
}

function loadStore(): StoreData {
  try {
    if (existsSync(DATA_FILE)) {
      const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as StoreData;
      return { ...defaultStore(), ...parsed, seq: { ...defaultStore().seq, ...(parsed.seq ?? {}) } };
    }
  } catch {
    // ignore corrupt file and reinitialize
  }
  return defaultStore();
}

let state: StoreData = loadStore();

function saveStore(): void {
  try {
    mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
}

function toDec(val: unknown): Prisma.Decimal {
  if (val instanceof Prisma.Decimal) return val;
  return new Prisma.Decimal(String(val ?? '0.00'));
}

function toIsoDateStr(val: Date | string): string {
  if (val instanceof Date) return val.toISOString();
  return new Date(val).toISOString();
}

function hydrateAccount(a: StoredAccount, include?: any) {
  const base: any = {
    ...a,
    openingBalance: toDec(a.openingBalance),
    createdAt: new Date(a.createdAt),
    updatedAt: new Date(a.updatedAt),
  };
  if (include?.loginUser) {
    const u = state.adminUsers.find((x) => x.accountId === a.id) ?? null;
    base.loginUser = u ? { id: u.id, username: u.username, role: u.role } : null;
  }
  return base;
}

function hydrateAdminUser(u: StoredAdminUser, include?: any) {
  const base: any = {
    ...u,
    createdAt: new Date(u.createdAt),
    updatedAt: new Date(u.updatedAt),
  };
  if (include?.account) {
    const a = u.accountId ? state.accounts.find((x) => x.id === u.accountId) ?? null : null;
    base.account = a ? hydrateAccount(a) : null;
  }
  return base;
}

function hydrateLedgerEntry(e: StoredLedgerEntry, includeOrSelect?: any) {
  const account = state.accounts.find((a) => a.id === e.accountId);
  const reversedBy = state.ledgerEntries.find((r) => r.reversalOfId === e.id) ?? null;
  const reviewedBy = e.reviewedById ? state.adminUsers.find((u) => u.id === e.reviewedById) ?? null : null;
  return {
    ...e,
    entryDate: new Date(e.entryDate),
    amount: toDec(e.amount),
    reviewedAt: e.reviewedAt ? new Date(e.reviewedAt) : null,
    createdAt: new Date(e.createdAt),
    account: account
      ? { id: account.id, accountCode: account.accountCode, name: account.name, type: account.type }
      : { id: e.accountId, accountCode: 'ACC', name: 'Unknown', type: 'CUSTOMER' as AccountType },
    reversedBy: reversedBy ? { id: reversedBy.id } : null,
    reviewedBy: reviewedBy ? { id: reviewedBy.id, username: reviewedBy.username } : null,
    ...(includeOrSelect ? {} : {}),
  };
}

function matchesAccountWhere(a: StoredAccount, where?: any): boolean {
  if (!where) return true;
  if (where.id !== undefined) {
    if (typeof where.id === 'number' && a.id !== where.id) return false;
    if (where.id?.in && !where.id.in.includes(a.id)) return false;
  }
  if (where.accountCode !== undefined && a.accountCode !== where.accountCode) return false;
  if (where.type !== undefined && a.type !== where.type) return false;
  if (where.isActive !== undefined && a.isActive !== where.isActive) return false;
  if (where.OR && Array.isArray(where.OR)) {
    const anyMatch = where.OR.some((cond: any) => {
      if (cond.name?.contains) return a.name.toLowerCase().includes(String(cond.name.contains).toLowerCase());
      if (cond.accountCode?.contains)
        return a.accountCode.toLowerCase().includes(String(cond.accountCode.contains).toLowerCase());
      if (cond.phone?.contains)
        return (a.phone ?? '').toLowerCase().includes(String(cond.phone.contains).toLowerCase());
      if (cond.email?.contains)
        return (a.email ?? '').toLowerCase().includes(String(cond.email.contains).toLowerCase());
      return false;
    });
    if (!anyMatch) return false;
  }
  return true;
}

function matchesLedgerWhere(e: StoredLedgerEntry, where?: any): boolean {
  if (!where) return true;
  if (where.id !== undefined && e.id !== where.id) return false;
  if (where.reversalOfId !== undefined && e.reversalOfId !== where.reversalOfId) return false;
  if (where.accountId !== undefined) {
    if (typeof where.accountId === 'number' && e.accountId !== where.accountId) return false;
    if (where.accountId?.in && !where.accountId.in.includes(e.accountId)) return false;
  }
  if (where.approvalStatus !== undefined && e.approvalStatus !== where.approvalStatus) return false;
  if (where.type !== undefined) {
    if (typeof where.type === 'string' && e.type !== where.type) return false;
    if (where.type?.not && e.type === where.type.not) return false;
  }
  if (where.entryDate !== undefined) {
    const eDay = e.entryDate.slice(0, 10);
    if (where.entryDate instanceof Date || typeof where.entryDate === 'string') {
      const targetDay = toIsoDateStr(where.entryDate).slice(0, 10);
      if (eDay !== targetDay) return false;
    } else {
      if (where.entryDate.gte) {
        const gteDay = toIsoDateStr(where.entryDate.gte).slice(0, 10);
        if (eDay < gteDay) return false;
      }
      if (where.entryDate.lte) {
        const lteDay = toIsoDateStr(where.entryDate.lte).slice(0, 10);
        if (eDay > lteDay) return false;
      }
    }
  }
  if (where.OR && Array.isArray(where.OR)) {
    const account = state.accounts.find((a) => a.id === e.accountId);
    const anyMatch = where.OR.some((cond: any) => {
      if (cond.referenceNumber?.contains)
        return (e.referenceNumber ?? '').toLowerCase().includes(String(cond.referenceNumber.contains).toLowerCase());
      if (cond.notes?.contains)
        return (e.notes ?? '').toLowerCase().includes(String(cond.notes.contains).toLowerCase());
      if (cond.account?.name?.contains)
        return (account?.name ?? '').toLowerCase().includes(String(cond.account.name.contains).toLowerCase());
      if (cond.account?.accountCode?.contains)
        return (account?.accountCode ?? '').toLowerCase().includes(String(cond.account.accountCode.contains).toLowerCase());
      return false;
    });
    if (!anyMatch) return false;
  }
  return true;
}

export function createEmbeddedPrismaClient(): any {
  const client: any = {
    adminUser: {
      async findUnique({ where, include }: any) {
        const found = state.adminUsers.find((u) => {
          if (where.id !== undefined) return u.id === where.id;
          if (where.username !== undefined) {
            const needle = String(where.username).trim().toLowerCase();
            if (u.username.toLowerCase() === needle) return true;
            if (u.accountId) {
              const acct = state.accounts.find((a) => a.id === u.accountId);
              if (acct && acct.name.trim().toLowerCase() === needle) return true;
            }
            return false;
          }
          if (where.accountId !== undefined) return u.accountId === where.accountId;
          return false;
        });
        return found ? hydrateAdminUser(found, include) : null;
      },
      async findFirst({ where }: any = {}) {
        let list = [...state.adminUsers];
        if (where?.role) list = list.filter((u) => u.role === where.role);
        list.sort((a, b) => a.id - b.id);
        return list[0] ? hydrateAdminUser(list[0]) : null;
      },
      async create({ data }: any) {
        const now = new Date().toISOString();
        const item: StoredAdminUser = {
          id: ++state.seq.adminUser,
          username: data.username,
          passwordHash: data.passwordHash,
          role: data.role ?? 'ADMIN',
          accountId: data.accountId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        state.adminUsers.push(item);
        saveStore();
        return hydrateAdminUser(item);
      },
      async update({ where, data }: any) {
        const idx = state.adminUsers.findIndex((u) => u.id === where.id);
        if (idx === -1) throw new Error('AdminUser not found');
        const current = state.adminUsers[idx]!;
        const updated: StoredAdminUser = {
          ...current,
          ...(data.username !== undefined ? { username: data.username } : {}),
          ...(data.passwordHash !== undefined ? { passwordHash: data.passwordHash } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
          updatedAt: new Date().toISOString(),
        };
        state.adminUsers[idx] = updated;
        saveStore();
        return hydrateAdminUser(updated);
      },
    },

    session: {
      async findUnique({ where, include }: any) {
        const found = state.sessions.find((s) => s.id === where.id);
        if (!found) return null;
        const base: any = {
          ...found,
          createdAt: new Date(found.createdAt),
          lastSeenAt: new Date(found.lastSeenAt),
          expiresAt: new Date(found.expiresAt),
        };
        if (include?.adminUser) {
          const u = state.adminUsers.find((x) => x.id === found.adminUserId) ?? null;
          base.adminUser = u ? hydrateAdminUser(u, include.adminUser.include) : null;
        }
        return base;
      },
      async create({ data }: any) {
        const now = new Date().toISOString();
        const item: StoredSession = {
          id: data.id,
          adminUserId: data.adminUserId,
          createdAt: data.createdAt ? toIsoDateStr(data.createdAt) : now,
          lastSeenAt: data.lastSeenAt ? toIsoDateStr(data.lastSeenAt) : now,
          expiresAt: toIsoDateStr(data.expiresAt),
          userAgent: data.userAgent ?? null,
        };
        state.sessions = state.sessions.filter((s) => s.id !== item.id);
        state.sessions.push(item);
        saveStore();
        return {
          ...item,
          createdAt: new Date(item.createdAt),
          lastSeenAt: new Date(item.lastSeenAt),
          expiresAt: new Date(item.expiresAt),
        };
      },
      async update({ where, data }: any) {
        const idx = state.sessions.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error('Session not found');
        const current = state.sessions[idx]!;
        const updated: StoredSession = {
          ...current,
          ...(data.lastSeenAt ? { lastSeenAt: toIsoDateStr(data.lastSeenAt) } : {}),
          ...(data.expiresAt ? { expiresAt: toIsoDateStr(data.expiresAt) } : {}),
        };
        state.sessions[idx] = updated;
        saveStore();
        return updated;
      },
      async delete({ where }: any) {
        state.sessions = state.sessions.filter((s) => s.id !== where.id);
        saveStore();
      },
      async deleteMany({ where }: any = {}) {
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((s) => {
          if (where?.id && s.id !== where.id) return true;
          if (where?.adminUserId && s.adminUserId !== where.adminUserId) return true;
          if (where?.NOT?.id && s.id === where.NOT.id) return true;
          if (where?.expiresAt?.lt) {
            const lt = toIsoDateStr(where.expiresAt.lt);
            if (!(s.expiresAt < lt)) return true;
          }
          return false;
        });
        saveStore();
        return { count: before - state.sessions.length };
      },
    },

    account: {
      async count({ where }: any = {}) {
        return state.accounts.filter((a) => matchesAccountWhere(a, where)).length;
      },
      async findMany({ where, orderBy, skip, take, include }: any = {}) {
        let rows = state.accounts.filter((a) => matchesAccountWhere(a, where));
        if (orderBy) {
          const firstOrder = Array.isArray(orderBy) ? orderBy[0] : orderBy;
          if (firstOrder?.name) {
            rows.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
          } else if (firstOrder?.accountCode) {
            rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.id - b.id);
          } else if (firstOrder?.createdAt === 'desc') {
            rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
          }
        }
        if (typeof skip === 'number') rows = rows.slice(skip);
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows.map((a) => hydrateAccount(a, include ?? { loginUser: true }));
      },
      async findUnique({ where, include }: any) {
        const found = state.accounts.find((a) => {
          if (where.id !== undefined) return a.id === where.id;
          if (where.accountCode !== undefined) return a.accountCode === where.accountCode;
          return false;
        });
        return found ? hydrateAccount(found, include) : null;
      },
      async findUniqueOrThrow(args: any) {
        const res = await client.account.findUnique(args);
        if (!res) throw new Error('Account not found');
        return res;
      },
      async create({ data, include }: any) {
        const now = new Date().toISOString();
        const item: StoredAccount = {
          id: ++state.seq.account,
          accountCode: data.accountCode,
          name: data.name,
          type: data.type,
          phone: data.phone ?? null,
          email: data.email ?? null,
          address: data.address ?? null,
          openingBalance: String(data.openingBalance ?? '0.00'),
          openingBalanceSide: data.openingBalanceSide,
          notes: data.notes ?? null,
          isActive: data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        state.accounts.push(item);
        saveStore();
        return hydrateAccount(item, include);
      },
      async update({ where, data, include }: any) {
        const idx = state.accounts.findIndex((a) => a.id === where.id);
        if (idx === -1) throw new Error('Account not found');
        const current = state.accounts[idx]!;
        const updated: StoredAccount = {
          ...current,
          ...(data.accountCode !== undefined ? { accountCode: data.accountCode } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.address !== undefined ? { address: data.address } : {}),
          ...(data.openingBalance !== undefined ? { openingBalance: String(data.openingBalance) } : {}),
          ...(data.openingBalanceSide !== undefined ? { openingBalanceSide: data.openingBalanceSide } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          updatedAt: new Date().toISOString(),
        };
        state.accounts[idx] = updated;
        saveStore();
        return hydrateAccount(updated, include);
      },
    },

    ledgerEntry: {
      async count({ where }: any = {}) {
        return state.ledgerEntries.filter((e) => matchesLedgerWhere(e, where)).length;
      },
      async findMany({ where, orderBy, skip, take, include, select }: any = {}) {
        let rows = state.ledgerEntries.filter((e) => matchesLedgerWhere(e, where));
        const firstOrder = Array.isArray(orderBy) ? orderBy[0] : orderBy;
        if (firstOrder?.entryDate === 'asc') {
          rows.sort((a, b) => a.entryDate.slice(0, 10).localeCompare(b.entryDate.slice(0, 10)) || a.id - b.id);
        } else if (firstOrder?.createdAt === 'desc') {
          rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
        } else {
          rows.sort((a, b) => b.entryDate.slice(0, 10).localeCompare(a.entryDate.slice(0, 10)) || b.id - a.id);
        }
        if (typeof skip === 'number') rows = rows.slice(skip);
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows.map((e) => hydrateLedgerEntry(e, include ?? select));
      },
      async findUnique({ where, include, select }: any) {
        const found = state.ledgerEntries.find((e) => {
          if (where.id !== undefined) return e.id === where.id;
          if (where.reversalOfId !== undefined) return e.reversalOfId === where.reversalOfId;
          return false;
        });
        return found ? hydrateLedgerEntry(found, include ?? select) : null;
      },
      async findUniqueOrThrow(args: any) {
        const res = await client.ledgerEntry.findUnique(args);
        if (!res) throw new Error('LedgerEntry not found');
        return res;
      },
      async create({ data, include }: any) {
        const now = new Date().toISOString();
        const item: StoredLedgerEntry = {
          id: ++state.seq.ledgerEntry,
          accountId: data.accountId,
          entryDate: toIsoDateStr(data.entryDate),
          type: data.type,
          side: data.side,
          direction: data.direction,
          amount: String(data.amount),
          paymentMethod: data.paymentMethod ?? null,
          referenceNumber: data.referenceNumber ?? null,
          notes: data.notes ?? null,
          reversalOfId: data.reversalOfId ?? null,
          approvalStatus: data.approvalStatus ?? 'APPROVED',
          reviewedById: data.reviewedById ?? null,
          reviewedAt: data.reviewedAt ? toIsoDateStr(data.reviewedAt) : null,
          rejectionReason: data.rejectionReason ?? null,
          createdById: data.createdById ?? null,
          createdAt: now,
        };
        state.ledgerEntries.push(item);
        saveStore();
        return hydrateLedgerEntry(item, include);
      },
      async update({ where, data, include }: any) {
        const idx = state.ledgerEntries.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error('LedgerEntry not found');
        const current = state.ledgerEntries[idx]!;
        const updated: StoredLedgerEntry = {
          ...current,
          ...(data.approvalStatus !== undefined ? { approvalStatus: data.approvalStatus } : {}),
          ...(data.reviewedById !== undefined ? { reviewedById: data.reviewedById } : {}),
          ...(data.reviewedAt !== undefined
            ? { reviewedAt: data.reviewedAt ? toIsoDateStr(data.reviewedAt) : null }
            : {}),
          ...(data.rejectionReason !== undefined ? { rejectionReason: data.rejectionReason } : {}),
        };
        state.ledgerEntries[idx] = updated;
        saveStore();
        return hydrateLedgerEntry(updated, include);
      },
      async groupBy({ by, where, _sum, _max, _count }: any) {
        const rows = state.ledgerEntries.filter((e) => matchesLedgerWhere(e, where));
        const groups = new Map<string, StoredLedgerEntry[]>();
        for (const r of rows) {
          const key = (by as string[]).map((k) => String((r as any)[k])).join('||');
          const list = groups.get(key) ?? [];
          list.push(r);
          groups.set(key, list);
        }
        const results: any[] = [];
        for (const list of groups.values()) {
          const sample = list[0]!;
          const out: any = {};
          for (const k of by as string[]) out[k] = (sample as any)[k];
          if (_sum?.amount) {
            let sum = new Prisma.Decimal(0);
            for (const item of list) sum = sum.plus(new Prisma.Decimal(item.amount));
            out._sum = { amount: sum };
          }
          if (_max?.entryDate) {
            let maxIso = list[0]!.entryDate;
            for (const item of list) {
              if (item.entryDate > maxIso) maxIso = item.entryDate;
            }
            out._max = { entryDate: new Date(maxIso) };
          }
          if (_count?._all) {
            out._count = { _all: list.length };
          }
          results.push(out);
        }
        return results;
      },
    },

    auditLog: {
      async count({ where }: any = {}) {
        let rows = state.auditLogs;
        if (where?.entityType) rows = rows.filter((a) => a.entityType === where.entityType);
        return rows.length;
      },
      async findMany({ where, skip, take }: any = {}) {
        let rows = [...state.auditLogs];
        if (where?.entityType) rows = rows.filter((a) => a.entityType === where.entityType);
        rows.sort((a, b) => b.id - a.id);
        if (typeof skip === 'number') rows = rows.slice(skip);
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows.map((r) => {
          const actor = r.actorId ? state.adminUsers.find((u) => u.id === r.actorId) ?? null : null;
          return {
            ...r,
            createdAt: new Date(r.createdAt),
            actor: actor ? { id: actor.id, username: actor.username } : null,
          };
        });
      },
      async create({ data }: any) {
        const item: StoredAuditLog = {
          id: ++state.seq.auditLog,
          action: data.action,
          entityType: data.entityType,
          entityId: String(data.entityId),
          actorId: data.actorId ?? null,
          details: data.details ?? null,
          createdAt: new Date().toISOString(),
        };
        state.auditLogs.push(item);
        saveStore();
        return { ...item, createdAt: new Date(item.createdAt) };
      },
    },

    idempotencyKey: {
      async findUnique({ where }: any) {
        const scope = where.scope_keyHash?.scope;
        const keyHash = where.scope_keyHash?.keyHash;
        const found = state.idempotencyKeys.find((k) => k.scope === scope && k.keyHash === keyHash);
        if (!found) return null;
        return {
          ...found,
          createdAt: new Date(found.createdAt),
          expiresAt: new Date(found.expiresAt),
        };
      },
      async create({ data }: any) {
        const exists = state.idempotencyKeys.find((k) => k.scope === data.scope && k.keyHash === data.keyHash);
        if (exists) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const item: StoredIdempotencyKey = {
          id: ++state.seq.idempotencyKey,
          scope: data.scope,
          keyHash: data.keyHash,
          requestHash: data.requestHash,
          status: data.status,
          responseStatus: data.responseStatus ?? null,
          responseBody: data.responseBody ?? null,
          createdAt: new Date().toISOString(),
          expiresAt: toIsoDateStr(data.expiresAt),
        };
        state.idempotencyKeys.push(item);
        saveStore();
        return {
          ...item,
          createdAt: new Date(item.createdAt),
          expiresAt: new Date(item.expiresAt),
        };
      },
      async update({ where, data }: any) {
        const idx = state.idempotencyKeys.findIndex((k) => k.id === where.id);
        if (idx === -1) throw new Error('IdempotencyKey not found');
        const current = state.idempotencyKeys[idx]!;
        const updated: StoredIdempotencyKey = {
          ...current,
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.responseStatus !== undefined ? { responseStatus: data.responseStatus } : {}),
          ...(data.responseBody !== undefined ? { responseBody: data.responseBody } : {}),
        };
        state.idempotencyKeys[idx] = updated;
        saveStore();
        return updated;
      },
      async deleteMany({ where }: any = {}) {
        const before = state.idempotencyKeys.length;
        state.idempotencyKeys = state.idempotencyKeys.filter((k) => {
          if (where?.id !== undefined && k.id === where.id) {
            if (where.status && k.status !== where.status) return true;
            return false;
          }
          if (where?.expiresAt?.lt) {
            const lt = toIsoDateStr(where.expiresAt.lt);
            if (k.expiresAt < lt) return false;
          }
          return true;
        });
        saveStore();
        return { count: before - state.idempotencyKeys.length };
      },
    },

    appSetting: {
      async upsert({ where, update, create }: any) {
        const idx = state.appSettings.findIndex((s) => s.id === where.id);
        if (idx === -1) {
          const item: StoredAppSetting = {
            id: create.id ?? 1,
            businessName: create.businessName ?? 'My Business',
            businessAddress: create.businessAddress ?? null,
            businessPhone: create.businessPhone ?? null,
            businessEmail: create.businessEmail ?? null,
            currencySymbol: create.currencySymbol ?? '₹',
            timezone: create.timezone ?? 'Asia/Kolkata',
            userEntryOptions: create.userEntryOptions ?? null,
            updatedAt: new Date().toISOString(),
          };
          state.appSettings.push(item);
          saveStore();
          return { ...item, updatedAt: new Date(item.updatedAt) };
        }
        const current = state.appSettings[idx]!;
        const updated: StoredAppSetting = {
          ...current,
          ...update,
          updatedAt: new Date().toISOString(),
        };
        state.appSettings[idx] = updated;
        saveStore();
        return { ...updated, updatedAt: new Date(updated.updatedAt) };
      },
      async update({ where, data }: any) {
        const idx = state.appSettings.findIndex((s) => s.id === where.id);
        const current =
          idx !== -1
            ? state.appSettings[idx]!
            : {
                id: where.id ?? 1,
                businessName: 'My Business',
                businessAddress: null,
                businessPhone: null,
                businessEmail: null,
                currencySymbol: '₹',
                timezone: 'Asia/Kolkata',
                userEntryOptions: null,
                updatedAt: new Date().toISOString(),
              };
        const updated: StoredAppSetting = {
          ...current,
          ...data,
          updatedAt: new Date().toISOString(),
        };
        if (idx === -1) state.appSettings.push(updated);
        else state.appSettings[idx] = updated;
        saveStore();
        return { ...updated, updatedAt: new Date(updated.updatedAt) };
      },
    },

    async $transaction(fnOrArray: any) {
      if (Array.isArray(fnOrArray)) {
        return Promise.all(fnOrArray);
      }
      return fnOrArray(client);
    },

    async $queryRaw(_strings: TemplateStringsArray, ...values: any[]) {
      // Used by health check (`SELECT 1`) and lockAccount (`SELECT id, type, isActive FROM Account WHERE id = ? FOR UPDATE`)
      const queryText = _strings.join('?');
      if (queryText.includes('FROM Account')) {
        const id = Number(values[0]);
        const acct = state.accounts.find((a) => a.id === id);
        return acct ? [{ id: acct.id, type: acct.type, isActive: acct.isActive }] : [];
      }
      return [{ 1: 1 }];
    },

    async $disconnect() {
      saveStore();
    },
  };

  return client;
}
