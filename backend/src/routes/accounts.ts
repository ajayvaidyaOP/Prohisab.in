import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, type Db } from '../db/prisma.ts';
import { audit } from '../lib/audit.ts';
import { isoDateToDbDate } from '../lib/dates.ts';
import { errors } from '../lib/errors.ts';
import { withIdempotency } from '../lib/idempotency.ts';
import { hashPassword, hashPin, pinDigest, validPassword } from '../lib/password.ts';
import { dateParam, id, normalizeName, nullableString, num, pagination, paging, parse, textParam } from '../lib/validation.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { optionFromSummary, summary } from '../services/accounts.ts';
import { businessToday } from '../services/settings.ts';

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get('/', requireAdmin, async (req, res) => {
  const { page, pageSize, skip } = paging(req.query);
  const search = textParam(req.query.search)?.slice(0, 150);
  const status = textParam(req.query.status)?.toLowerCase();
  if (status && !['all', 'active', 'inactive'].includes(status)) throw errors.badRequest('Invalid account status.');
  const where = { role: 'USER',
    ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { accountCode: { contains: search } },
      { phone: { contains: search } }, { email: { contains: search } }] } : {}),
  };
  const sort = req.query.sort === 'newest' ? { createdAt: 'desc' as const }
    : req.query.sort === 'code' ? { accountCode: 'asc' as const } : { name: 'asc' as const };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: sort, skip, take: pageSize, select: { id: true } }),
    prisma.user.count({ where }),
  ]);
  res.json({ items: await Promise.all(rows.map((row) => summary(prisma, row.id))), pagination: pagination(page, pageSize, total) });
});

accountsRouter.get('/options', requireAdmin, async (req, res) => {
  const search = textParam(req.query.search)?.slice(0, 150);
  const users = await prisma.user.findMany({ where: { role: 'USER',
    ...(search ? { OR: [{ name: { contains: search } }, { accountCode: { contains: search } }] } : {}) },
    orderBy: { name: 'asc' }, select: { id: true }, take: 500 });
  const rows = await Promise.all(users.map((user) => summary(prisma, user.id)));
  res.json({ items: rows.map(optionFromSummary) });
});

function ensureVisible(requested: bigint, viewer: ReturnType<typeof actor>) {
  if (viewer.role !== 'ADMIN' && requested !== viewer.id) throw errors.forbidden('You can only view your own account.');
}
accountsRouter.get('/:id', async (req, res) => {
  const accountId = id(req.params.id);
  ensureVisible(accountId, actor(req));
  res.json({ account: await summary(prisma, accountId) });
});

const pinField = z.string().regex(/^\d{4}$/, 'Enter exactly 4 digits.');
const createSchema = z.object({
  name: z.string().trim().min(2).max(150), password: z.string().max(100).optional(), pin: pinField.optional(),
  phone: z.string().max(30).nullish(), email: z.string().max(190).nullish(),
  address: z.string().max(500).nullish(), notes: z.string().max(500).nullish(),
});
async function assertPinAvailable(pin: string, excludeId?: bigint, db: Db = prisma) {
  const existing = await db.user.findFirst({ where: { OR: [{ pin }, { pinDigest: pinDigest(pin) }],
    ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  if (existing) throw errors.conflict('DUPLICATE_RECORD', 'That staff PIN is already in use.', [{ field: 'pin', message: 'Choose another PIN.' }]);
}
accountsRouter.post('/', requireAdmin, async (req, res) => {
  const body = parse(createSchema, req.body);
  if (!body.pin && !body.password) throw errors.badRequest('Provide a staff PIN or password.', [{ field: 'pin', message: 'Enter a 4-digit PIN or password.' }]);
  if (body.password && !validPassword(body.password)) throw errors.unprocessable('PASSWORD_TOO_WEAK', 'Password must contain at least 6 characters with letters and numbers.', [{ field: 'password', message: 'Use letters and numbers.' }]);
  const passwordHash = await hashPassword(body.password || randomBytes(32).toString('hex'));
  const pinHash = body.pin ? await hashPin(body.pin) : null;
  const result = await withIdempotency('POST /api/accounts', actor(req).id, req.get('Idempotency-Key') || undefined,
    { name: body.name, password: body.password, pin: body.pin }, async (tx) => {
      if (body.pin) await assertPinAvailable(body.pin, undefined, tx);
      const created = await tx.user.create({ data: {
        name: body.name, nameNormalized: normalizeName(body.name),
        passwordHash, pinHash, pinDigest: body.pin ? pinDigest(body.pin) : null,
        role: 'USER', accountCode: `TMP-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        phone: nullableString(body.phone), email: nullableString(body.email),
        address: nullableString(body.address), notes: nullableString(body.notes), isActive: true,
      } });
      await tx.user.update({ where: { id: created.id }, data: { accountCode: `USR-${String(created.id).padStart(6, '0')}` } });
      await audit(tx, 'USER_CREATED', 'User', created.id, actor(req).id, { name: body.name, role: 'USER' });
      return { status: 201, body: { account: await summary(tx, created.id) } };
    });
  res.status(result.status).json(result.body);
});

const updateSchema = z.object({ name: z.string().trim().min(2).max(150).optional(),
  phone: z.string().max(30).nullish(), email: z.string().max(190).nullish(),
  address: z.string().max(500).nullish(), notes: z.string().max(500).nullish(),
}).refine((obj) => Object.keys(obj).length > 0, 'No changes provided.');
accountsRouter.patch('/:id', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const body = parse(updateSchema, req.body);
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current || current.role !== 'USER') throw errors.notFound('User account not found.');
  const account = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: {
      ...(body.name !== undefined ? { name: body.name, nameNormalized: normalizeName(body.name) } : {}),
      ...(body.phone !== undefined ? { phone: nullableString(body.phone) } : {}),
      ...(body.email !== undefined ? { email: nullableString(body.email) } : {}),
      ...(body.address !== undefined ? { address: nullableString(body.address) } : {}),
      ...(body.notes !== undefined ? { notes: nullableString(body.notes) } : {}),
    } });
    await audit(tx, 'USER_UPDATED', 'User', userId, actor(req).id, { fields: Object.keys(body) });
    return summary(tx, userId);
  });
  res.json({ account });
});

accountsRouter.patch('/:id/status', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'USER') throw errors.notFound('User account not found.');
  const account = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) await tx.session.deleteMany({ where: { userId } });
    await audit(tx, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'User', userId, actor(req).id);
    return summary(tx, userId);
  });
  res.json({ account });
});

accountsRouter.post('/:id/reset-password', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const body = parse(z.object({ newPassword: z.string().min(1), confirmPassword: z.string().min(1) }), req.body);
  if (body.newPassword !== body.confirmPassword) throw errors.badRequest('Passwords do not match.', [{ field: 'confirmPassword', message: 'Passwords do not match.' }]);
  if (!validPassword(body.newPassword)) throw errors.unprocessable('PASSWORD_TOO_WEAK', 'Password must have at least 6 characters with letters and numbers.', [{ field: 'newPassword', message: 'Use letters and numbers.' }]);
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'USER') throw errors.notFound('User account not found.');
  const newHash = await hashPassword(body.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    await tx.session.deleteMany({ where: { userId } });
    await audit(tx, 'PASSWORD_RESET', 'User', userId, actor(req).id, { targetUser: target.name });
  });
  res.status(204).end();
});

accountsRouter.put('/:id/pin', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const { pin } = parse(z.object({ pin: z.union([pinField, z.null(), z.literal('')]) }), req.body);
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'USER') throw errors.notFound('User account not found.');
  if (pin) await assertPinAvailable(pin, userId);
  const newHash = pin ? await hashPin(pin) : null;
  const account = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { pin: null, pinDigest: pin ? pinDigest(pin) : null, pinHash: newHash } });
    await tx.session.deleteMany({ where: { userId } });
    await audit(tx, pin ? 'PIN_RESET' : 'PIN_DISABLED', 'User', userId, actor(req).id, { enabled: !!pin });
    return summary(tx, userId);
  });
  res.json({ account });
});

accountsRouter.put('/:id/books', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const ids = parse(z.array(z.number().int().positive().safe()).max(200), req.body);
  const distinct = [...new Set(ids)].map((bookId) => id(bookId, 'bookId'));
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'USER') throw errors.notFound('User account not found.');
  if (distinct.length) {
    const books = await prisma.book.findMany({ where: { id: { in: distinct }, status: 'ACTIVE' } });
    if (books.length !== distinct.length) throw errors.badRequest('All assigned books must exist and be active.');
  }
  const account = await prisma.$transaction(async (tx) => {
    await tx.userBook.deleteMany({ where: { userId } });
    if (distinct.length) await tx.userBook.createMany({ data: distinct.map((bookId) => ({ userId, bookId })) });
    await audit(tx, 'USER_BOOKS_UPDATED', 'User', userId, actor(req).id, { bookIds: distinct.map((b) => num(b)) });
    return summary(tx, userId);
  });
  res.json({ account });
});

accountsRouter.patch('/:id/back-date', requireAdmin, async (req, res) => {
  const userId = id(req.params.id);
  const { date } = parse(z.object({ date: z.string().nullish() }), req.body);
  const grantDate = dateParam(date, 'date');
  if (grantDate && grantDate > await businessToday()) throw errors.badRequest('The permitted date cannot be in the future.');
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'USER') throw errors.notFound('User account not found.');
  const account = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { backDateAllowedDate: grantDate ? isoDateToDbDate(grantDate) : null } });
    await audit(tx, grantDate ? 'BACK_DATE_GRANTED' : 'BACK_DATE_REVOKED', 'User', userId, actor(req).id, { date: grantDate ?? null });
    return summary(tx, userId);
  });
  res.json({ account });
});
