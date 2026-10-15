import { hash, verify } from '@node-rs/argon2';

/**
 * Passwords are hashed with Argon2id (OWASP-recommended parameters: 19 MiB memory, 2 iterations).
 * Plaintext passwords are never logged or stored.
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashValue, plain);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Runs a real Argon2 verification against a throwaway hash when the username does not exist,
 * so response time does not reveal which usernames exist.
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHashPromise ??= hashPassword(`dummy-${Math.random()}-${Date.now()}`);
  await verifyPassword(await dummyHashPromise, plain);
}
