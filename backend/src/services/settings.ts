import type { Db } from '../db/prisma.ts';
import { env } from '../config/env.ts';
import { todayInTimeZone } from '../lib/dates.ts';

export const DEFAULT_OPTIONS = [
  'Cash Deposit', 'UPI / Bank Deposit', 'Cash Withdrawal', 'UPI / Bank Withdrawal',
  'Site Material', 'Petrol / Transport', 'Hardware Bill', 'Office Expense',
];

export async function appSettings(db: Db) {
  return db.appSetting.upsert({ where: { id: 1n }, create: { id: 1n, timezone: env.APP_TIMEZONE }, update: {} });
}

export async function businessToday(): Promise<string> {
  const { prisma } = await import('../db/prisma.ts');
  const row = await appSettings(prisma);
  return todayInTimeZone(row.timezone);
}

export async function activeOptions(db: Db): Promise<string[]> {
  const rows = await db.entryOption.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return rows.map((row) => row.name);
}

export async function businessView(db: Db) {
  const [row, userEntryOptions] = await Promise.all([appSettings(db), activeOptions(db)]);
  return {
    businessName: row.businessName, businessAddress: row.businessAddress,
    businessPhone: row.businessPhone, businessEmail: row.businessEmail,
    currencySymbol: row.currencySymbol, timezone: row.timezone,
    logoUrl: row.logoUrl, userEntryOptions, updatedAt: row.updatedAt.toISOString(),
  };
}
