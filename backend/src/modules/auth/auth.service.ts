import { prisma } from '../../db/prisma.ts';
import { env } from '../../config/env.ts';
import { errors } from '../../lib/errors.ts';
import { burnPasswordCheck, verifyPassword } from '../../lib/password.ts';
import { generateSessionToken, sha256Hex } from '../../lib/security.ts';
import { writeAudit } from '../../lib/audit.ts';

export const SESSION_MAX_MS = env.SESSION_MAX_HOURS * 60 * 60 * 1000;

export async function login(params: { username: string; password: string; userAgent?: string }) {
  const admin = await prisma.adminUser.findUnique({ where: { username: params.username } });
  if (!admin) {
    await burnPasswordCheck(params.password);
    throw errors.unauthorized('Invalid username or password.');
  }
  const valid = await verifyPassword(admin.passwordHash, params.password);
  if (!valid) {
    await writeAudit(prisma, {
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'AdminUser',
      entityId: admin.id,
      actorId: admin.id,
      details: { reason: 'bad_password' },
    });
    throw errors.unauthorized('Invalid username or password.');
  }

  const token = generateSessionToken();
  const now = new Date();
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.create({
      data: {
        id: sha256Hex(token),
        adminUserId: admin.id,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_MAX_MS),
        userAgent: params.userAgent?.slice(0, 255) ?? null,
      },
    }),
  ]);
  await writeAudit(prisma, { action: 'AUTH_LOGIN', entityType: 'AdminUser', entityId: admin.id, actorId: admin.id });

  return { token, admin: { id: admin.id, username: admin.username } };
}

export async function logout(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
