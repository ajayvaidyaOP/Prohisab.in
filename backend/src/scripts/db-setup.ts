import { prisma } from '../db/prisma.ts';
import { migrateMySql } from './migrate.ts';
import { seedDatabase } from './seed.ts';

async function main() {
  if (process.env.USE_EMBEDDED_DB === 'true') {
    throw new Error('db:setup is for MySQL. The demo database is initialized automatically by npm run dev.');
  }
  await migrateMySql();
  await seedDatabase(prisma);
  console.log('Database ready. Existing users, credentials, books, transactions and audit records were not replaced.');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
