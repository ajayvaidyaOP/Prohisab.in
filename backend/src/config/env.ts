import 'dotenv/config';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required. See backend/.env.example.')
    .refine((value) => value.startsWith('mysql://'), 'DATABASE_URL must start with mysql:// (MySQL only).'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  DB_SSL: booleanFlag.default(false),
  DB_SSL_REJECT_UNAUTHORIZED: booleanFlag.default(false),
  APP_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(43200).default(120),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  COOKIE_SECURE: booleanFlag.optional(),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).optional(),
  TRUST_PROXY: booleanFlag.default(false),
  CORS_ORIGIN: z.string().optional(),
  FRONTEND_DIST: z.string().optional(),
  // Only used by the seed / db:setup script; never stored in code.
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & {
  COOKIE_SECURE_EFFECTIVE: boolean;
  COOKIE_SAME_SITE_EFFECTIVE: 'strict' | 'lax' | 'none';
  CORS_ORIGINS: string[];
};

function loadEnv(): AppEnv {
  const rawEnv = { ...process.env };
  if (!rawEnv.DATABASE_URL && rawEnv.NODE_ENV !== 'production') {
    rawEnv.DATABASE_URL = 'mysql://root:@localhost:3306/erp_ledger';
  }
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  const cookieSecureEffective = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
  const corsOrigins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const cookieSameSiteEffective =
    env.COOKIE_SAME_SITE ?? (corsOrigins.length > 0 && cookieSecureEffective ? 'none' : 'strict');

  return {
    ...env,
    COOKIE_SECURE_EFFECTIVE: cookieSecureEffective,
    COOKIE_SAME_SITE_EFFECTIVE: cookieSameSiteEffective,
    CORS_ORIGINS: corsOrigins,
  };
}

export const env: AppEnv = loadEnv();
