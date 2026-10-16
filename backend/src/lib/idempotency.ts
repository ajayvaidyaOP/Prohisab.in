import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.ts';
import { prisma, type Tx } from '../db/prisma.ts';
import { errors } from './errors.ts';
import { sha256Hex, stableStringify } from './security.ts';

export type WriteResult<T extends object> = { status: number; body: T };

/** A financial write + its replayable response commit in the SAME MySQL transaction. */
export async function withIdempotency<T extends object>(
  scope: string, actorId: bigint, key: string | undefined, payload: unknown,
  work: (tx: Tx) => Promise<WriteResult<T>>,
): Promise<WriteResult<T & { replayed: boolean }>> {
  if (key !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw errors.badRequest('Invalid Idempotency-Key header.');
  }
  const fullScope = `${scope}:user:${actorId}`;
  const keyHash = key && sha256Hex(key);
  // Creation requests may contain a 4-digit PIN. An unkeyed request hash would
  // allow offline brute force by anyone who can read the idempotency table.
  const requestHash = createHmac('sha256', env.PIN_PEPPER).update(stableStringify(payload)).digest('hex');
  // Bounded replay window: delete expired keys before claiming a new one. The
  // indexed expiry lookup keeps this cheap, and the financial write is still
  // atomically committed with its own response in the transaction below.
  if (keyHash) await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    return await prisma.$transaction(async (tx) => {
      if (keyHash) {
        await tx.idempotencyKey.create({ data: {
          scope: fullScope, keyHash, requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        } });
      }
      const result = await work(tx);
      const body = { ...result.body, replayed: false };
      if (keyHash) {
        // Prisma JSON cannot contain BigInt; serializers must convert IDs to safe numbers.
        await tx.idempotencyKey.update({
          where: { scope_keyHash: { scope: fullScope, keyHash } },
          data: { responseStatus: result.status, responseBody: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue },
        });
      }
      return { status: result.status, body };
    }, { timeout: 20_000 });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || !keyHash) throw error;
    const saved = await prisma.idempotencyKey.findUnique({ where: { scope_keyHash: { scope: fullScope, keyHash } } });
    if (!saved) throw error; // Another unique constraint failed inside the work itself.
    if (saved.requestHash !== requestHash) {
      throw errors.conflict('IDEMPOTENCY_KEY_REUSED', 'This retry key was already used for a different request.');
    }
    if (saved.responseBody == null || saved.responseStatus == null) {
      throw errors.conflict('REQUEST_IN_PROGRESS', 'This request is still being processed. Please retry shortly.');
    }
    return {
      status: saved.responseStatus,
      body: { ...(saved.responseBody as T), replayed: true },
    };
  }
}
