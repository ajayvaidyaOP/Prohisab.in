import type { Db } from '../db/prisma.ts';
import { num } from './validation.ts';

export async function audit(db: Db, action: string, entityType: string, entityId: bigint | number | string,
  actorId: bigint | null, details?: Record<string, unknown>) {
  const encoded = details ? JSON.stringify(details, (_key, value) => typeof value === 'bigint' ? num(value) : value) : null;
  await db.auditLog.create({ data: {
    action, entityType, entityId: String(entityId), actorId,
    details: encoded && encoded.length <= 2000 ? encoded : encoded ? '{"truncated":true}' : null,
  } });
}
