// Prisma Client generation configuration. Do NOT run Prisma Migrate against the
// mapped Spring-era schema; our non-destructive SQL runner is `npm run db:setup`.
// The runtime app connects through the MariaDB/MySQL adapter in src/db/prisma.ts.
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
