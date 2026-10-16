import { createHmac } from 'node:crypto';
import { verify as argonVerify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.ts';

// Spring Boot stored BCrypt ($2a$); the first Node stack used Argon2id.
// Both can sign in after migration. All newly set passwords use BCrypt.
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    if (/^\$2[aby]\$/.test(hash)) return await bcrypt.compare(password, hash);
    if (hash.startsWith('$argon2')) return await argonVerify(hash, password);
  } catch { /* Treat malformed/unknown hashes as invalid. */ }
  return false;
}

let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('an-invalid-account-password');
  await verifyPassword(await dummyHash, password);
}

export function validPassword(value: string): boolean {
  return value.length >= 6 && value.length <= 100 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

/** Searchable but secret-keyed digest; a stolen DB alone cannot enumerate 10,000 PINs. */
export function pinDigest(pin: string): string {
  return createHmac('sha256', env.PIN_PEPPER).update(`deposit.in:pin:${pin}`, 'utf8').digest('hex');
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 12);
}

export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  try { return await bcrypt.compare(pin, hash); } catch { return false; }
}
