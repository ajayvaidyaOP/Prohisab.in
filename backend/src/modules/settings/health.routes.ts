import { Router } from 'express';
import { prisma } from '../../db/prisma.ts';

export const healthRouter = Router();

/** Public liveness/readiness probe. Returns no configuration or secrets. */
healthRouter.get('/', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});
