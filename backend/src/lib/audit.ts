import type { Prisma } from '../generated/prisma/client.ts';
import type { Tx, DbClient } from '../db/prisma.ts';

export type AuditInput = {
  action: string;
  entityType: string;
  entityId: string | number;
  actorId?: number | null;
  details?: Record<string, unknown>;
};

/**
 * Appends an audit record. Call inside the same database transaction as the change it describes,
 * so the audit trail can never disagree with the data.
 */
export async function writeAudit(db: Tx | DbClient, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: String(input.entityId),
      actorId: input.actorId ?? null,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
    },
  });
}
