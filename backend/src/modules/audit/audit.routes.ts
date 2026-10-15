import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.ts';
import { validate, getQuery } from '../../middleware/validate.ts';

export const auditRouter = Router();

const auditQuery = z.object({
  entityType: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Read-only audit trail (records are append-only at the database level). */
auditRouter.get('/', validate(auditQuery, 'query'), async (req, res) => {
  const query = getQuery<z.infer<typeof auditQuery>>(req);
  const where = query.entityType ? { entityType: query.entityType } : {};
  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { actor: { select: { username: true } } },
    }),
  ]);
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor?.username ?? null,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  });
});
