import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { hashPassword } from '../lib/password.ts';
import { DEFAULT_OPTIONS } from '../services/settings.ts';

/** Only inserts missing defaults. Never resets passwords or overwrites business data. */
export async function seedDatabase(db: PrismaClient = prisma) {
  await db.appSetting.upsert({ where: { id: 1n }, create: { id: 1n, timezone: env.APP_TIMEZONE }, update: {} });
  if (!await db.entryOption.count()) {
    await db.entryOption.createMany({ data: DEFAULT_OPTIONS.map((name, sortOrder) => ({
      name, nameNormalized: name.toLowerCase(), sortOrder, isActive: true,
    })) });
    console.log('Seeded default entry options.');
  }
  if (!await db.user.count({ where: { role: 'ADMIN' } })) {
    const name = env.ADMIN_NAME.trim() || 'admin';
    const password = env.ADMIN_PASSWORD || (process.env.USE_EMBEDDED_DB === 'true' ? 'Admin@12345' : randomBytes(24).toString('base64url'));
    const created = await db.user.create({ data: {
      name, nameNormalized: name.toLowerCase(), role: 'ADMIN',
      passwordHash: await hashPassword(password), accountCode: `TMP-${randomUUID().slice(0, 12)}`,
      isActive: true,
    } });
    await db.user.update({ where: { id: created.id }, data: { accountCode: `ADM-${String(created.id).padStart(6, '0')}` } });
    console.log(`\nINITIAL ADMIN (created once): ${name} / ${password}\nChange this password immediately. Do not share this log.\n`);
  }
}

if (process.argv[1] && /(?:^|\/)seed\.(?:ts|js)$/.test(process.argv[1])) {
  seedDatabase().catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
