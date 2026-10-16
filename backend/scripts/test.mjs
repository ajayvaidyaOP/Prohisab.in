import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const files = readdirSync('tests').filter((name) => name.endsWith('.test.ts')).map((name) => path.join('tests', name));
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', USE_EMBEDDED_DB: 'true', DEMO_IN_MEMORY: 'true',
    ADMIN_PASSWORD: 'Admin@12345', COOKIE_SECURE: 'false' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
