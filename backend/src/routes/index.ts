import { Router } from 'express';
import { prisma } from '../db/prisma.ts';
import { authRouter } from './auth.ts';
import { accountsRouter } from './accounts.ts';
import { ledgerRouter } from './ledger.ts';
import { transactionsRouter } from './transactions.ts';
import { dashboardRouter } from './dashboard.ts';
import { booksRouter } from './books.ts';
import { settingsRouter } from './settings.ts';
import { auditRouter } from './audit.ts';

export const apiRouter = Router();
apiRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'UP', database: 'UP' });
  } catch {
    res.status(503).json({ status: 'DOWN', database: 'DOWN' });
  }
});
apiRouter.use('/auth', authRouter);
apiRouter.use('/accounts', ledgerRouter);
apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/books', booksRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/audit-logs', auditRouter);
