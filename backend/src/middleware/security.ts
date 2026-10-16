import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { errors } from '../lib/errors.ts';

function isAllowedCorsOrigin(origin: string): boolean {
  const normalized = origin.trim().replace(/\/+$/, '').toLowerCase();
  return env.CORS_ORIGINS.some((allowed) => allowed === '*' || allowed.toLowerCase() === normalized);
}

/**
 * Optional CORS support when frontend and backend are deployed on separate domains
 * (for example, Frontend on Vercel/Netlify and Backend on Render/Railway).
 * Only active when CORS_ORIGIN is set in backend/.env.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('Origin');
  if (origin && env.CORS_ORIGINS.length > 0 && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, X-Requested-With, Idempotency-Key, X-Session-Token');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Cross-site request protection for cookie-authenticated APIs (defense in depth alongside SameSite):
 *  - Every state-changing request must carry the custom header `X-Requested-With`.
 *    Browsers cannot attach custom headers in cross-site form posts.
 *  - If an Origin header is present it must match the host this server is serving,
 *    the proxied host (`X-Forwarded-Host`), or an explicitly configured `CORS_ORIGIN`.
 */
export function requireSameOriginWrites(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
    next(errors.forbidden('Missing request header. Please reload the page and try again.'));
    return;
  }
  const origin = req.get('Origin');
  if (origin) {
    if (env.CORS_ORIGINS.length > 0 && isAllowedCorsOrigin(origin)) {
      next();
      return;
    }
    const host = req.get('Host');
    const forwardedHost = req.get('X-Forwarded-Host')?.split(',')[0]?.trim();
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const matchesHost = Boolean(host && originHost && originHost.toLowerCase() === host.toLowerCase());
    const matchesForwardedHost = Boolean(
      forwardedHost && originHost && originHost.toLowerCase() === forwardedHost.toLowerCase(),
    );
    if (!matchesHost && !matchesForwardedHost) {
      next(errors.forbidden('Cross-site request blocked.'));
      return;
    }
  }
  next();
}
