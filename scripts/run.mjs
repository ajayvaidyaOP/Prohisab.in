#!/usr/bin/env node
/** Root helper: demo uses MariaDB WASM; MySQL deployment uses the same Prisma schema. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function start(args, cwd, environment = {}) {
  return spawn(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, ...environment } });
}
function wait(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`)));
  });
}
const demoEnv = { USE_EMBEDDED_DB: 'true', HOST: '0.0.0.0', PORT: '4000', COOKIE_SECURE: 'false' };

async function main() {
  switch (process.argv[2] ?? 'dev') {
    case 'setup':
      await wait(start(['ci', '--no-audit', '--no-fund'], backend), 'Backend install');
      await wait(start(['ci', '--no-audit', '--no-fund'], frontend), 'Frontend install');
      console.log('\nSetup complete. Use npm run dev for the no-MySQL preview, or configure backend/.env and run npm run db:setup for MySQL.');
      break;
    case 'dev:backend':
      await wait(start(['run', 'dev'], backend, demoEnv), 'Backend');
      break;
    case 'dev': {
      console.log('Starting Express/Prisma API (:4000, persistent MariaDB WASM demo) and Vite (:5173).');
      const api = start(['run', 'dev'], backend, demoEnv);
      const ui = start(['run', 'dev'], frontend);
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        api.kill('SIGTERM'); ui.kill('SIGTERM');
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      api.on('exit', (code) => { if (!stopping) { console.error(`Backend stopped (${code})`); stop(); process.exitCode = code || 1; } });
      ui.on('exit', (code) => { if (!stopping) { console.error(`Frontend stopped (${code})`); stop(); process.exitCode = code || 1; } });
      break;
    }
    default:
      throw new Error('Usage: npm run setup | dev | dev:backend');
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
