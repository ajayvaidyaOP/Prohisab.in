import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { audit } from '../lib/audit.ts';
import { isValidTimeZone, todayInTimeZone } from '../lib/dates.ts';
import { errors } from '../lib/errors.ts';
import { id, normalizeName, nullableString, num, parse } from '../lib/validation.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';
import { appSettings, businessView } from '../services/settings.ts';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);
settingsRouter.get('/', async (req, res) => {
  const business = await businessView(prisma);
  res.json({ business, today: todayInTimeZone(business.timezone), user: { username: actor(req).name },
    session: { idleTimeoutMinutes: env.SESSION_IDLE_MINUTES, maxSessionHours: env.SESSION_MAX_HOURS } });
});

const settingsSchema = z.object({
  businessName: z.string().trim().min(2).max(150),
  businessAddress: z.string().max(500).nullish(), businessPhone: z.string().max(30).nullish(),
  businessEmail: z.string().max(190).nullish(), currencySymbol: z.string().trim().min(1).max(8),
  timezone: z.string().min(1).max(64), logoUrl: z.string().max(500).nullish(),
});
settingsRouter.put('/', requireAdmin, async (req, res) => {
  const body = parse(settingsSchema, req.body);
  if (!isValidTimeZone(body.timezone)) throw errors.badRequest('Choose a valid time zone.', [{ field: 'timezone', message: 'Invalid IANA time zone.' }]);
  if (body.logoUrl && !/^https?:\/\//i.test(body.logoUrl)) throw errors.badRequest('Logo URL must use HTTP or HTTPS.', [{ field: 'logoUrl', message: 'Enter a valid URL.' }]);
  const business = await prisma.$transaction(async (tx) => {
    const before = await appSettings(tx);
    await tx.appSetting.update({ where: { id: 1n }, data: {
      businessName: body.businessName, businessAddress: nullableString(body.businessAddress),
      businessPhone: nullableString(body.businessPhone), businessEmail: nullableString(body.businessEmail),
      currencySymbol: body.currencySymbol, timezone: body.timezone, logoUrl: nullableString(body.logoUrl),
    } });
    await audit(tx, 'SETTINGS_UPDATED', 'AppSetting', 1, actor(req).id,
      { businessName: { from: before.businessName, to: body.businessName } });
    return businessView(tx);
  });
  res.json({ business, today: todayInTimeZone(business.timezone) });
});

const optionsSchema = z.object({ options: z.array(z.string().trim().min(2).max(120)).min(1).max(100) });
settingsRouter.put('/entry-options', requireAdmin, async (req, res) => {
  const { options } = parse(optionsSchema, req.body);
  const unique = [...new Map(options.map((name) => [normalizeName(name), name])).values()];
  const business = await prisma.$transaction(async (tx) => {
    const existing = await tx.entryOption.findMany();
    const lookup = new Map(existing.map((item) => [item.nameNormalized, item]));
    for (const old of existing) {
      if (!unique.some((name) => normalizeName(name) === old.nameNormalized) && old.isActive) {
        await tx.entryOption.update({ where: { id: old.id }, data: { isActive: false } });
      }
    }
    for (const [sortOrder, name] of unique.entries()) {
      const normalized = normalizeName(name);
      const found = lookup.get(normalized);
      if (found) {
        await tx.entryOption.update({ where: { id: found.id }, data: { name, sortOrder, isActive: true } });
      } else {
        await tx.entryOption.create({ data: { name, nameNormalized: normalized, sortOrder, isActive: true } });
      }
    }
    await audit(tx, 'ENTRY_OPTIONS_REPLACED', 'EntryOption', 'all', actor(req).id, { options: unique });
    return businessView(tx);
  });
  res.json({ business, userEntryOptions: business.userEntryOptions });
});

async function optionView(option: { id: bigint; name: string; sortOrder: number; isActive: boolean }) {
  const usageCount = await prisma.transaction.count({ where: { optionName: option.name } });
  return { id: num(option.id), name: option.name, sortOrder: option.sortOrder, isActive: option.isActive, usageCount };
}
settingsRouter.get('/entry-options', async (req, res) => {
  const items = await prisma.entryOption.findMany({ where: actor(req).role === 'ADMIN' ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  res.json({ items: await Promise.all(items.map(optionView)) });
});
settingsRouter.post('/entry-options', requireAdmin, async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(2).max(120) }), req.body);
  const current = await prisma.entryOption.findFirst({ orderBy: { sortOrder: 'desc' } });
  const row = await prisma.entryOption.create({ data: { name, nameNormalized: normalizeName(name),
    sortOrder: (current?.sortOrder ?? -1) + 1 } });
  await audit(prisma, 'ENTRY_OPTION_CREATED', 'EntryOption', row.id, actor(req).id, { name });
  res.status(201).json({ option: await optionView(row) });
});
settingsRouter.patch('/entry-options/:id', requireAdmin, async (req, res) => {
  const optionId = id(req.params.id);
  const data = parse(z.object({ name: z.string().trim().min(2).max(120).optional(),
    isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).optional() }), req.body);
  const before = await prisma.entryOption.findUnique({ where: { id: optionId } });
  if (!before) throw errors.notFound('Option not found.');
  const after = await prisma.entryOption.update({ where: { id: optionId }, data: {
    ...(data.name !== undefined ? { name: data.name, nameNormalized: normalizeName(data.name) } : {}),
    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
  } });
  await audit(prisma, 'ENTRY_OPTION_UPDATED', 'EntryOption', optionId, actor(req).id, { fields: Object.keys(data) });
  res.json({ option: await optionView(after) });
});
settingsRouter.post('/entry-options/:id/deactivate', requireAdmin, async (req, res) => {
  const optionId = id(req.params.id);
  const after = await prisma.entryOption.update({ where: { id: optionId }, data: { isActive: false } });
  await audit(prisma, 'ENTRY_OPTION_DEACTIVATED', 'EntryOption', optionId, actor(req).id);
  res.json({ option: await optionView(after) });
});
settingsRouter.delete('/entry-options/:id', requireAdmin, async (req, res) => {
  const optionId = id(req.params.id);
  const before = await prisma.entryOption.findUnique({ where: { id: optionId } });
  if (!before) throw errors.notFound('Option not found.');
  if (await prisma.transaction.count({ where: { optionName: before.name } })) {
    throw errors.conflict('OPTION_IN_USE', 'This option is used by ledger entries. Deactivate it instead.');
  }
  await prisma.entryOption.delete({ where: { id: optionId } });
  await audit(prisma, 'ENTRY_OPTION_DELETED', 'EntryOption', optionId, actor(req).id);
  res.status(204).end();
});
