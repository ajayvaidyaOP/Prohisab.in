import { Router } from 'express';
import { requireAdminRole } from '../../middleware/auth.ts';
import * as dashboard from './dashboard.service.ts';

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAdminRole, async (_req, res) => {
  res.json(await dashboard.getDashboard());
});

dashboardRouter.get('/summary.pdf', requireAdminRole, async (_req, res) => {
  const { filename, content } = await dashboard.exportAllUsersSummaryPdf();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

