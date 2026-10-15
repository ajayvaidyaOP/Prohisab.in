import { Router } from 'express';
import * as dashboard from './dashboard.service.ts';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_req, res) => {
  res.json(await dashboard.getDashboard());
});
