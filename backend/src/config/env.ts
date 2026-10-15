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
  APP_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(43200).default(120),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  COOKIE_SECURE: booleanFlag.optional(),
  TRUST_PROXY: booleanFlag.default(false),
  FRONTEND_DIST: z.string().optional(),
  // Only used by the seed script; never stored in code.
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & { COOKIE_SECURE_EFFECTIVE: boolean };

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  return {
    ...env,
    COOKIE_SECURE_EFFECTIVE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  };
}

export const env: AppEnv = loadEnv();
