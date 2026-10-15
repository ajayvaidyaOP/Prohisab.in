import { Router } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import { healthRouter } from '../modules/settings/health.routes.ts';
import { authRouter } from '../modules/auth/auth.routes.ts';
import { accountsRouter } from '../modules/accounts/accounts.routes.ts';
import { ledgerRouter } from '../modules/ledger/ledger.routes.ts';
import { transactionsRouter } from '../modules/transactions/transactions.routes.ts';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.ts';
import { settingsRouter } from '../modules/settings/settings.routes.ts';
import { auditRouter } from '../modules/audit/audit.routes.ts';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter); // login is public; logout/me handle their own checks

apiRouter.use(requireAuth); // everything below requires a signed-in administrator
apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/accounts', ledgerRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/audit-logs', auditRouter);
