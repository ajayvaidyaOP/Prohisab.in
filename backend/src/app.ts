import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.ts';
import { errors } from './lib/errors.ts';
import { apiRouter } from './routes/index.ts';
import { requestId, notFound, errorHandler } from './middleware/http.ts';
import { corsMiddleware, requireSameOriginWrites } from './middleware/security.ts';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  const isProduction = env.NODE_ENV === 'production';
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Admin-configured business logo URL. Plain HTTP images are only useful
          // during local development; production pages must not load mixed content.
          'img-src': ["'self'", 'data:', 'https:', ...(isProduction ? [] : ['http:'])],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-src': ["'self'"],
          // Assets are same-origin, so forced HTTPS upgrades only risk breaking a
          // plain-HTTP LAN install; HTTPS deployments stay protected by HSTS.
          'upgrade-insecure-requests': null,
          'frame-ancestors': ["'self'", 'https://*.e2b.app', 'https://arena.ai', 'https://*.arena.ai'], // live Arena preview
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // This app needs no device APIs; deny them explicitly for any injected content.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });
  app.use(requestId);
  app.use('/api', corsMiddleware);

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(errors.tooManyRequests()),
  });

  app.use('/api', apiLimiter);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', requireSameOriginWrites);
  app.use('/api', apiRouter);
  app.use('/api', notFound);

  // Serve the built React app (production). In development Vite serves the frontend and proxies /api.
  const frontendDist = env.FRONTEND_DIST
    ? path.resolve(env.FRONTEND_DIST)
    : path.resolve(process.cwd(), '../frontend/dist');
  if (existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(
      express.static(frontendDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } else {
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res
        .status(200)
        .type('text/plain')
        .send('ERP API is running. The frontend build was not found: run "npm run build" in /frontend, or use the Vite dev server.');
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
