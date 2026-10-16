import 'dotenv/config';
import { z } from 'zod';

const flag = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().startsWith('mysql://'),
  DB_SSL: flag.default(false),
  DB_SSL_REJECT_UNAUTHORIZED: flag.default(true),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(43200).default(120),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  COOKIE_SECURE: flag.optional(),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).optional(),
  TRUST_PROXY: flag.default(false),
  ALLOWED_ORIGINS: z.string().default(''),
  FRONTEND_DIST: z.string().optional(),
  ADMIN_NAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().optional(),
  PIN_PEPPER: z.string().optional(),
});

const raw = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || (process.env.NODE_ENV === 'production'
    ? '' : 'mysql://root:@localhost:3306/depositin'),
};
const result = schema.safeParse(raw);
if (!result.success) {
  throw new Error(`Invalid backend configuration:\n${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
}
const parsed = result.data;
if (parsed.NODE_ENV === 'production' && process.env.USE_EMBEDDED_DB === 'true') {
  throw new Error('The MariaDB WASM demo database is for local development only. Set USE_EMBEDDED_DB=false for production.');
}
if (parsed.NODE_ENV === 'production' && (!parsed.PIN_PEPPER || parsed.PIN_PEPPER.length < 32)) {
  throw new Error('Set PIN_PEPPER to a persistent random secret (32+ characters) in production. Do not rotate it without resetting staff PINs.');
}
const origins = parsed.ALLOWED_ORIGINS.split(',').map((v) => v.trim().replace(/\/+$/, '')).filter(Boolean);
if (origins.some((origin) => !/^https?:\/\/[^/]+$/i.test(origin) || origin.includes('*'))) {
  throw new Error('ALLOWED_ORIGINS must list explicit http(s) origins only (no wildcard or path).');
}
export const env = {
  ...parsed,
  PIN_PEPPER: parsed.PIN_PEPPER || 'development-only-pin-pepper-do-not-deploy',
  COOKIE_SECURE_EFFECTIVE: parsed.COOKIE_SECURE ?? parsed.NODE_ENV === 'production',
  COOKIE_SAME_SITE_EFFECTIVE: parsed.COOKIE_SAME_SITE ?? (origins.length && (parsed.COOKIE_SECURE ?? parsed.NODE_ENV === 'production') ? 'none' : 'lax'),
  CORS_ORIGINS: origins,
};
