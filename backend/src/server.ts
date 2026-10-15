import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';
import { createApp } from './app.ts';

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`ERP ledger API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down...`);
  server.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
