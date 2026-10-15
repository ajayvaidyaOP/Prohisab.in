import type { NextFunction, Request, Response } from 'express';
import { errors } from '../lib/errors.ts';

/**
 * Cross-site request protection for cookie-authenticated APIs (defense in depth alongside SameSite=Strict):
 *  - Every state-changing request must carry the custom header `X-Requested-With`.
 *    Browsers cannot attach custom headers in cross-site form posts, and we never enable CORS.
 *  - If an Origin header is present it must match the host this server is serving.
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
    // Compare hosts only: behind a TLS-terminating proxy or the dev proxy the scheme seen by Express can differ
    // from the browser's scheme, but the host in Origin must always equal the host the browser addressed.
    const host = req.get('Host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || !originHost || originHost.toLowerCase() !== host.toLowerCase()) {
      next(errors.forbidden('Cross-site request blocked.'));
      return;
    }
  }
  next();
}
