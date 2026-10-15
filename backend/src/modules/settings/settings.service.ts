import { prisma } from '../../db/prisma.ts';
import { env } from '../../config/env.ts';
import { errors } from '../../lib/errors.ts';
import { writeAudit } from '../../lib/audit.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import { todayInTimeZone } from '../../lib/dates.ts';
import type { SettingsUpdateBody, PasswordChangeBody } from './settings.schemas.ts';

export async function getSettings() {
  return prisma.appSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, timezone: env.APP_TIMEZONE },
  });
}

function serializeSettings(row: Awaited<ReturnType<typeof getSettings>>) {
  return {
    businessName: row.businessName,
    businessAddress: row.businessAddress,
    businessPhone: row.businessPhone,
    businessEmail: row.businessEmail,
    currencySymbol: row.currencySymbol,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSettingsView(username: string) {
  const row = await getSettings();
  return {
    business: serializeSettings(row),
    today: todayInTimeZone(row.timezone),
    user: { username },
    session: {
      idleTimeoutMinutes: env.SESSION_IDLE_MINUTES,
      maxSessionHours: env.SESSION_MAX_HOURS,
    },
  };
}

export async function updateSettings(input: SettingsUpdateBody, actorId: number) {
  const before = await getSettings();
  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.appSetting.update({
      where: { id: 1 },
      data: {
        businessName: input.businessName,
        businessAddress: input.businessAddress,
        businessPhone: input.businessPhone,
        businessEmail: input.businessEmail,
        currencySymbol: input.currencySymbol,
        timezone: input.timezone,
      },
    });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of ['businessName', 'businessAddress', 'businessPhone', 'businessEmail', 'currencySymbol', 'timezone'] as const) {
      if (before[key] !== updated[key]) changes[key] = { from: before[key], to: updated[key] };
    }
    if (Object.keys(changes).length > 0) {
      await writeAudit(tx, { action: 'SETTINGS_UPDATED', entityType: 'AppSetting', entityId: 1, actorId, details: { changes } });
    }
    return updated;
  });
  return { business: serializeSettings(after), today: todayInTimeZone(after.timezone) };
}

export async function changePassword(input: PasswordChangeBody, adminId: number, currentSessionId: string | undefined): Promise<void> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) throw errors.unauthorized();
  const valid = await verifyPassword(admin.passwordHash, input.currentPassword);
  if (!valid) {
    throw errors.unprocessable('INVALID_CURRENT_PASSWORD', 'Your current password is incorrect.', [
      { field: 'currentPassword', message: 'Incorrect password.' },
    ]);
  }
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
    // Sign out every other session; keep the current one so the user stays signed in here.
    await tx.session.deleteMany({
      where: { adminUserId: adminId, ...(currentSessionId ? { NOT: { id: currentSessionId } } : {}) },
    });
    await writeAudit(tx, { action: 'ADMIN_PASSWORD_CHANGED', entityType: 'AdminUser', entityId: adminId, actorId: adminId });
  });
}
