#!/usr/bin/env node
/**
 * Root helper script so developers can run the entire ERP project from the root folder in VS Code:
 *   npm run setup         -> installs backend & frontend dependencies + creates backend/.env if missing
 *   npm run dev           -> starts both Backend (port 4000) and Frontend (port 5173) in one terminal
 */
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function ensureEnvFile() {
  const envPath = path.join(rootDir, 'backend', '.env');
  const examplePath = path.join(rootDir, 'backend', '.env.example');
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log('✔ Created backend/.env from backend/.env.example');
    console.log('  👉 Open backend/.env in VS Code and put your MySQL password in DATABASE_URL.\n');
  }
}

function runCommand(cmd, args, cwd, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: isWin,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function runSetup() {
  console.log('=== Step 1/3: Installing Backend packages ===');
  await runCommand(npmCmd, ['install'], path.join(rootDir, 'backend'), 'backend install');

  console.log('\n=== Step 2/3: Installing Frontend packages ===');
  await runCommand(npmCmd, ['install'], path.join(rootDir, 'frontend'), 'frontend install');

  console.log('\n=== Step 3/3: Checking backend/.env ===');
  ensureEnvFile();

  console.log('\n✅ Setup complete!');
  console.log('Next steps in VS Code terminal:');
  console.log('  1. Edit backend/.env and set your MySQL password in DATABASE_URL');
  console.log('  2. Run: npm run db:setup:demo');
  console.log('  3. Run: npm run dev\n');
}

function runDevBoth() {
  ensureEnvFile();
  console.log('Starting Backend (http://localhost:4000) and Frontend (http://localhost:5173)...\n');

  const backend = spawn(npmCmd, ['run', 'dev'], {
    cwd: path.join(rootDir, 'backend'),
    stdio: 'inherit',
    shell: isWin,
  });

  const frontend = spawn(npmCmd, ['run', 'dev'], {
    cwd: path.join(rootDir, 'frontend'),
    stdio: 'inherit',
    shell: isWin,
  });

  const cleanup = () => {
    backend.kill('SIGINT');
    frontend.kill('SIGINT');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

const mode = process.argv[2];
if (mode === 'setup') {
  runSetup().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (mode === 'dev') {
  runDevBoth();
} else {
  console.error('Usage: node scripts/run.mjs <setup|dev>');
  process.exit(1);
}
