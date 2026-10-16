import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { env } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import { sha256Hex } from '../lib/security.ts';
import { num } from '../lib/validation.ts';

export const SESSION_COOKIE = 'erp_session';
export type Actor = { id: bigint; name: string; role: 'ADMIN' | 'USER'; accountCode: string };

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
    sessionId?: string;
  }
}

export function authUser(actor: Actor) {
  return { id: num(actor.id), username: actor.name, name: actor.name,
    role: actor.role, accountId: actor.role === 'USER' ? num(actor.id) : null };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[SESSION_COOKIE];
    // New Node tokens are 43 base64url chars; existing Spring tokens are 64 hex chars.
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(raw)) throw errors.unauthorized();
    const sessionId = sha256Hex(raw);
    const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    const now = Date.now();
    if (!session || session.expiresAt.getTime() <= now ||
        now - session.lastSeenAt.getTime() > env.SESSION_IDLE_MINUTES * 60_000 || !session.user.isActive) {
      if (session) await prisma.session.deleteMany({ where: { id: sessionId } });
      throw errors.unauthorized('Your session has expired. Please sign in again.');
    }
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(now) } });
    }
    req.actor = { id: session.user.id, name: session.user.name,
      role: session.user.role === 'ADMIN' ? 'ADMIN' : 'USER', accountCode: session.user.accountCode };
    req.sessionId = sessionId;
    next();
  } catch (error) { next(error); }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.actor?.role !== 'ADMIN') return next(errors.forbidden('Only the administrator can perform this action.'));
  next();
}

export function actor(req: Request): Actor {
  if (!req.actor) throw errors.unauthorized();
  return req.actor;
}
