import { Router, type CookieOptions, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { audit } from '../lib/audit.ts';
import { AppError, errors } from '../lib/errors.ts';
import { burnPasswordCheck, hashPassword, hashPin, pinDigest, validPassword, verifyPassword, verifyPin } from '../lib/password.ts';
import { generateSessionToken, sha256Hex } from '../lib/security.ts';
import { normalizeName, parse } from '../lib/validation.ts';
import { actor, authUser, requireAuth, SESSION_COOKIE, type Actor } from '../middleware/auth.ts';

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const MAX_AGE_MS = env.SESSION_MAX_HOURS * 3_600_000;

/** Arena displays the HTTPS *.e2b.app preview inside an arena.ai iframe.
 * SameSite=Lax cookies are not sent from that iframe; a Secure, Partitioned
 * cookie is needed there. Keep Lax cookies for normal localhost development.
 */
function isEmbeddedPreview(req: Request): boolean {
  const host = req.get('Host')?.split(':')[0]?.toLowerCase() ?? '';
  return env.NODE_ENV !== 'production' && /^[a-z0-9-]+\.e2b\.app$/.test(host);
}
function cookieOptions(req: Request): CookieOptions {
  if (isEmbeddedPreview(req)) {
    return { httpOnly: true, sameSite: 'none', secure: true, partitioned: true, path: '/' };
  }
  return { httpOnly: true, sameSite: env.COOKIE_SAME_SITE_EFFECTIVE,
    secure: env.COOKIE_SECURE_EFFECTIVE, path: '/' };
}
function writeSessionCookie(req: Request, res: Response, token: string): void {
  if (isEmbeddedPreview(req)) {
    // Remove a stale unpartitioned cookie from before the preview fix.
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  }
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: MAX_AGE_MS });
}
function clearSessionCookies(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  if (isEmbeddedPreview(req)) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  }
}
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10,
  standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true,
  handler: (_req, _res, next) => next(errors.tooManyRequests('Too many sign-in attempts. Please wait 15 minutes.')),
});

async function signIn(user: { id: bigint; name: string; role: string; accountCode: string }, userAgent: string | undefined) {
  const token = generateSessionToken();
  const now = new Date();
  await prisma.session.create({ data: {
    id: sha256Hex(token), userId: user.id, createdAt: now, lastSeenAt: now,
    expiresAt: new Date(now.getTime() + MAX_AGE_MS), userAgent: userAgent?.slice(0, 255) ?? null,
  } });
  await audit(prisma, 'AUTH_LOGIN', 'User', user.id, user.id, { method: userAgent === undefined ? 'unknown' : 'browser' });
  const current: Actor = { id: user.id, name: user.name, role: user.role === 'ADMIN' ? 'ADMIN' : 'USER', accountCode: user.accountCode };
  return { token, user: authUser(current) };
}

const loginSchema = z.object({ username: z.string().trim().min(1).max(150), password: z.string().min(1).max(100) });
authRouter.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { nameNormalized: normalizeName(username) } });
  if (!user) await burnPasswordCheck(password);
  if (!user || !user.isActive || !await verifyPassword(user.passwordHash, password)) {
    if (user) await audit(prisma, 'AUTH_LOGIN_FAILED', 'User', user.id, user.id, { reason: 'bad_credentials' });
    throw errors.unauthorized('Invalid name or password.');
  }
  const result = await signIn(user, req.get('User-Agent'));
  writeSessionCookie(req, res, result.token);
  res.json({ user: result.user });
});

const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, 'Enter a 4-digit PIN.') });
authRouter.post('/pin-login', loginLimiter, async (req, res) => {
  const { pin } = parse(pinSchema, req.body);
  const digest = pinDigest(pin);
  const user = await prisma.user.findFirst({ where: { role: 'USER', OR: [{ pinDigest: digest }, { pin }] } });
  // Spring stored PINs as plaintext. Upgrade on first successful login (and on reset).
  const correct = user && user.isActive && (user.pinHash ? await verifyPin(user.pinHash, pin) : user.pin === pin);
  if (!correct || !user) {
    await burnPasswordCheck(pin);
    throw errors.unauthorized('Invalid PIN.');
  }
  if (!user.pinHash) {
    const changed = await prisma.user.updateMany({
      where: { id: user.id, pin, pinHash: null, isActive: true },
      data: { pin: null, pinDigest: digest, pinHash: await hashPin(pin) },
    });
    if (changed.count !== 1) throw errors.unauthorized('Your PIN has changed. Please sign in again.');
  }
  const result = await signIn(user, req.get('User-Agent'));
  writeSessionCookie(req, res, result.token);
  res.json({ user: result.user });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: authUser(actor(req)) }));
authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(raw)) {
    await prisma.session.deleteMany({ where: { id: sha256Hex(raw) } });
  }
  clearSessionCookies(req, res);
  res.status(204).end();
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  if (actor(req).role !== 'ADMIN') throw new AppError(403, 'PASSWORD_CHANGE_DISABLED',
    'Password changes are disabled. Ask the Administrator to reset your password.');
  const body = parse(z.object({
    currentPassword: z.string().min(1), newPassword: z.string().min(1), confirmPassword: z.string().min(1),
  }), req.body);
  if (body.newPassword !== body.confirmPassword) throw errors.badRequest('Passwords do not match.', [{ field: 'confirmPassword', message: 'Passwords do not match.' }]);
  if (!validPassword(body.newPassword)) throw errors.unprocessable('PASSWORD_TOO_WEAK', 'Use at least 6 characters with letters and numbers.', [{ field: 'newPassword', message: 'Use letters and numbers.' }]);
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: actor(req).id } });
  if (!await verifyPassword(admin.passwordHash, body.currentPassword)) throw errors.unauthorized('Current password is incorrect.');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
    await tx.session.deleteMany({ where: { userId: admin.id, id: { not: req.sessionId } } });
    await audit(tx, 'ADMIN_PASSWORD_CHANGED', 'User', admin.id, admin.id);
  });
  res.status(204).end();
});
