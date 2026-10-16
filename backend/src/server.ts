import { env } from './config/env.ts';
import { demoDatabase, prisma } from './db/prisma.ts';
import { seedDatabase } from './scripts/seed.ts';
import { createApp } from './app.ts';

async function main() {
  if (demoDatabase) {
    await seedDatabase(prisma);
    console.log('Using MariaDB WASM demo ledger. For production configure MySQL and run npm run db:setup.');
  }
  const server = createApp().listen(env.PORT, env.HOST, () => {
    console.log(`deposit.in API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
  });
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    await prisma.$disconnect();
    await demoDatabase?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
main().catch((error) => { console.error('Could not start API:', error); process.exitCode = 1; });
