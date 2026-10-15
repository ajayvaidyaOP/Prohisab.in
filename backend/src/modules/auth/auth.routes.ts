import { Router, type CookieOptions } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.ts';
import { errors } from '../../lib/errors.ts';
import { sha256Hex } from '../../lib/security.ts';
import { SESSION_COOKIE, requireAuth } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import { login, logout, SESSION_MAX_MS } from './auth.service.ts';
import { loginBody, type LoginBody } from './auth.schemas.ts';

export const authRouter = Router();

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.COOKIE_SECURE_EFFECTIVE,
    path: '/',
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, _res, next) => next(errors.tooManyRequests('Too many sign-in attempts. Please wait 15 minutes and try again.')),
});

authRouter.post('/login', loginLimiter, validate(loginBody), async (req, res) => {
  const body = req.body as LoginBody;
  const result = await login({
    username: body.username,
    password: body.password,
    userAgent: req.get('User-Agent') ?? undefined,
  });
  res.cookie(SESSION_COOKIE, result.token, { ...cookieOptions(), maxAge: SESSION_MAX_MS });
  res.json({ user: result.admin });
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = typeof req.cookies?.[SESSION_COOKIE] === 'string' ? (req.cookies[SESSION_COOKIE] as string) : undefined;
    if (token) {
      await logout(sha256Hex(token));
    }
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.admin });
});
