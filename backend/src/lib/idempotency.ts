import { Prisma } from '../generated/prisma/client.ts';
import { prisma, type Tx } from '../db/prisma.ts';
import { errors } from './errors.ts';
import { sha256Hex, stableStringify } from './security.ts';

/**
 * Idempotency for financial writes.
 *
 * Flow:
 *  1. The client sends `Idempotency-Key: <uuid>` with each submission.
 *  2. We insert a PROCESSING row (unique on scope+key). A second identical submission finds the row:
 *       - COMPLETED with the same request body  -> replay the stored response (no new write)
 *       - COMPLETED with a different body       -> 422 (key reused for a different request)
 *       - still PROCESSING                       -> 409 (request in progress)
 *  3. The business writes and the COMPLETED update run in ONE database transaction, so a crash
 *     can never leave a posted entry without its idempotency record.
 *  4. On failure the PROCESSING row is removed so the user can safely retry.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const PROCESSING_STALE_MS = 60_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type IdempotentResult = { status: number; body: unknown };

export function readIdempotencyKey(header: string | undefined): string {
  if (!header || !KEY_PATTERN.test(header)) {
    throw errors.badRequest('A valid Idempotency-Key header is required for this action (8-100 letters, digits, - or _).');
  }
  return header;
}

export async function withIdempotency(params: {
  scope: string;
  key: string;
  payload: unknown;
  work: (tx: Tx) => Promise<IdempotentResult>;
}): Promise<IdempotentResult & { replayed: boolean }> {
  const keyHash = sha256Hex(params.key);
  const requestHash = sha256Hex(stableStringify(params.payload));
  const now = new Date();

  // Opportunistic cleanup of expired records (bounded).
  await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => undefined);

  let rowId: number | null = null;
  for (let attempt = 0; attempt < 2 && rowId === null; attempt++) {
    try {
      const created = await prisma.idempotencyKey.create({
        data: {
          scope: params.scope,
          keyHash,
          requestHash,
          status: 'PROCESSING',
          expiresAt: new Date(now.getTime() + RETENTION_MS),
        },
        select: { id: true },
      });
      rowId = created.id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await prisma.idempotencyKey.findUnique({
        where: { scope_keyHash: { scope: params.scope, keyHash } },
      });
      if (!existing) continue; // removed between the two statements; try again
      if (existing.requestHash !== requestHash) {
        throw errors.unprocessable(
          'IDEMPOTENCY_KEY_REUSED',
          'This submission key was already used for a different request. Refresh the page and try again.',
        );
      }
      if (existing.status === 'COMPLETED') {
        return {
          status: existing.responseStatus ?? 200,
          body: existing.responseBody,
          replayed: true,
        };
      }
      // PROCESSING: either genuinely in flight, or a stale leftover from a crashed request.
      const ageMs = Date.now() - existing.createdAt.getTime();
      if (ageMs < PROCESSING_STALE_MS) {
        throw errors.conflict('REQUEST_IN_PROGRESS', 'This request is already being processed. Please wait a moment.');
      }
      await prisma.idempotencyKey.deleteMany({ where: { id: existing.id, status: 'PROCESSING' } });
    }
  }
  if (rowId === null) {
    throw errors.conflict('REQUEST_IN_PROGRESS', 'Could not start this request. Please try again.');
  }

  const id = rowId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const outcome = await params.work(tx);
      await tx.idempotencyKey.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          responseStatus: outcome.status,
          responseBody: outcome.body === undefined ? Prisma.JsonNull : (outcome.body as Prisma.InputJsonValue),
        },
      });
      return outcome;
    });
    return { ...result, replayed: false };
  } catch (error) {
    await prisma.idempotencyKey.deleteMany({ where: { id, status: 'PROCESSING' } }).catch(() => undefined);
    throw error;
  }
}
