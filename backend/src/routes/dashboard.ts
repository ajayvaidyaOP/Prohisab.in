import { Router } from 'express';
import { buildAllUsersSummaryPdf } from '../lib/pdf.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';
import { dashboardData } from '../services/dashboard.ts';
import { businessView } from '../services/settings.ts';
import { prisma } from '../db/prisma.ts';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireAdmin);
dashboardRouter.get('/', async (req, res) => res.json(await dashboardData(req.query)));
dashboardRouter.get('/summary.pdf', async (req, res) => {
  const data = await dashboardData(req.query);
  const business = await businessView(prisma);
  const pdf = buildAllUsersSummaryPdf({
    businessName: business.businessName, generatedDate: data.today,
    currencySymbol: business.currencySymbol,
    totalDeposit: data.userLedgerTotals.totalUserPaid,
    totalWithdrawal: data.userLedgerTotals.totalAdminPaid,
    totalNetBalance: data.userLedgerTotals.totalPending,
    totalPendingCount: data.userLedgerTotals.pendingSubmissionsCount,
    totalPendingAmount: data.userLedgerTotals.pendingSubmissionsAmount,
    rows: data.usersOverview.map((row) => ({ accountCode: row.accountCode, name: row.name,
      username: row.username, totalDeposit: row.totalUserPaid, totalWithdrawal: row.totalAdminPaid,
      netBalance: row.pendingBalance, pendingCount: row.pendingSubmissionsCount,
      pendingAmount: row.pendingSubmissionsAmount })),
  });
  res.type('application/pdf').attachment('all-users-summary.pdf').send(pdf);
});
