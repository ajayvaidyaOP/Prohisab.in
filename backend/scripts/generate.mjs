// Prisma Client generation uses the JS/WASM schema parser; the CLI eagerly
// downloads an unused schema-engine binary. Point it at Node for `generate`
// only so installs work in restricted/offline environments on every OS.
// Migrations are applied by src/scripts/migrate.ts using the MariaDB driver.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [cli, 'generate'], {
  stdio: 'inherit',
  env: { ...process.env, PRISMA_SCHEMA_ENGINE_BINARY: process.execPath },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
