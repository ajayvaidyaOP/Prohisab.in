import { Router } from 'express';
import { prisma } from '../db/prisma.ts';
import { num, pagination, paging, textParam } from '../lib/validation.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';

export const auditRouter = Router();
auditRouter.use(requireAuth, requireAdmin);
auditRouter.get('/', async (req, res) => {
  const { page, pageSize, skip } = paging(req.query, 25);
  const entityType = textParam(req.query.entityType)?.slice(0, 60);
  const where = entityType ? { entityType } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const items = rows.map((row) => {
    let details: unknown = null;
    if (row.details) { try { details = JSON.parse(row.details); } catch { details = row.details; } }
    return { id: num(row.id), action: row.action, entityType: row.entityType,
      entityId: row.entityId, actor: row.actor?.name ?? null, details, createdAt: row.createdAt.toISOString() };
  });
  res.json({ items, pagination: pagination(page, pageSize, total) });
});
