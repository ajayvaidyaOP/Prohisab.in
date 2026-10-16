import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../generated/prisma/client.ts';
import { prisma } from '../db/prisma.ts';
import { env } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import { sha256Hex } from '../lib/security.ts';

export const SESSION_COOKIE = 'erp_session';
export const IDLE_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthenticatedAdmin = {
  id: number;
  username: string;
  role: UserRole;
  accountId: number | null;
  name: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AuthenticatedAdmin;
    sessionId?: string;
  }
}

/** Server-side session check. The cookie holds an opaque random token; only its SHA-256 is stored. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const cookieToken = typeof req.cookies?.[SESSION_COOKIE] === 'string' ? (req.cookies[SESSION_COOKIE] as string) : '';
    const headerToken = req.get('X-Session-Token')?.trim() ?? '';
    const token = cookieToken || headerToken;
    if (!token) throw errors.unauthorized();

    const sessionId = sha256Hex(token);
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        adminUser: {
          select: {
            id: true,
            username: true,
            role: true,
            accountId: true,
            account: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    });
    const now = Date.now();
    const idleMs = env.SESSION_IDLE_MINUTES * 60_000;
    if (!session || session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > idleMs) {
      if (session) await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
      throw errors.unauthorized('Your session has expired. Please sign in again.');
    }

    if (session.adminUser.role === 'USER' && session.adminUser.account && !session.adminUser.account.isActive) {
      await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
      throw errors.unauthorized('Your account is inactive. Please contact the administrator.');
    }

    if (now - session.lastSeenAt.getTime() > IDLE_TOUCH_INTERVAL_MS) {
      await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
    }

    req.admin = {
      id: session.adminUser.id,
      username: session.adminUser.username,
      role: session.adminUser.role,
      accountId: session.adminUser.accountId ?? null,
      name: session.adminUser.account?.name ?? 'Administrator',
    };
    req.sessionId = sessionId;
    next();
  } catch (error) {
    next(error);
  }
}

/** Restricts a route to the Administrator role only. */
export function requireAdminRole(req: Request, _res: Response, next: NextFunction): void {
  if (!req.admin) {
    next(errors.unauthorized());
    return;
  }
  if (req.admin.role !== 'ADMIN') {
    next(errors.forbidden('Only the administrator can perform this action.'));
    return;
  }
  next();
}
