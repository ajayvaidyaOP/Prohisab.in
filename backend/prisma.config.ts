// Prisma CLI configuration (used by `prisma migrate deploy`, `prisma generate`, etc.).
// The runtime app connects through the MariaDB/MySQL driver adapter in src/db/prisma.ts.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
