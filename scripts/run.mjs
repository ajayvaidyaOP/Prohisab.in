#!/usr/bin/env node
/**
 * Root helper so the whole project can be run from the repository root:
 *
 *   npm run setup          -> install frontend dependencies
 *   npm run dev            -> backend (port 8080, in-memory demo DB) + frontend (port 5173)
 *   npm run dev:backend    -> Spring Boot only
 *   npm run dev:frontend   -> Vite only
 *   npm run build          -> backend jar + frontend production bundle
 *   npm run start          -> run the packaged backend jar
 *   npm run test           -> backend test suite (JUnit 5)
 *
 * The dev backend uses the `demo-h2` Maven profile and the `dev-h2` Spring
 * profile: an in-memory database with a seeded admin account (admin / Admin@12345),
 * so no MySQL setup is needed to try the app. Production runs use MySQL — see
 * README.md.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

/** Load backend/.env (KEY=VALUE lines) into the process environment, without overriding. */
function loadBackendEnv() {
  const envPath = path.join(backendDir, '.env');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return out;
}

function mvn(args) {
  const mvnBin = isWin ? path.join(backendDir, 'mvnw.cmd') : path.join(backendDir, 'mvnw');
  return [mvnBin, args, {
    cwd: backendDir,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, ...loadBackendEnv() },
  }];
}

function run(cmd, args, opts, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  const task = process.argv[2] ?? 'dev';

  switch (task) {
    case 'setup': {
      await run(npmCmd, ['ci'], { cwd: frontendDir, stdio: 'inherit', shell: isWin }, 'frontend install');
      console.log('\n✔ Frontend dependencies installed.');
      console.log('  Next: npm run dev  (backend on :8080, frontend on :5173)');
      break;
    }

    case 'dev': {
      console.log('Starting backend (demo-h2, in-memory DB) on :8080 and frontend on :5173 …');
      const [cmd, args, opts] = mvn(['-Pdemo-h2', 'spring-boot:run', '-Dspring-boot.run.profiles=dev-h2',
        '-Dspring-boot.run.arguments=--server.port=8080']);
      const backend = spawn(cmd, args, opts);
      const frontend = spawn(npmCmd, ['run', 'dev'], { cwd: frontendDir, stdio: 'inherit', shell: isWin });
      const stop = () => {
        backend.kill('SIGTERM');
        frontend.kill('SIGTERM');
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      backend.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`Backend exited with code ${code}`);
          stop();
        }
      });
      break;
    }

    case 'dev:backend': {
      const [cmd, args, opts] = mvn(['-Pdemo-h2', 'spring-boot:run', '-Dspring-boot.run.profiles=dev-h2',
        '-Dspring-boot.run.arguments=--server.port=8080']);
      await run(cmd, args, opts, 'backend');
      break;
    }

    case 'dev:frontend': {
      await run(npmCmd, ['run', 'dev'], { cwd: frontendDir, stdio: 'inherit', shell: isWin }, 'frontend');
      break;
    }

    case 'build': {
      console.log('Building backend jar (MySQL-only, no demo profile) …');
      const [cmd, args, opts] = mvn(['-o', 'clean', 'package', '-DskipTests']);
      // Not all environments have a populated ~/.m2; drop -o when online builds are fine.
      try {
        await run(cmd, args, opts, 'backend build');
      } catch {
        console.log('Offline build failed, retrying with network …');
        const [cmd2, args2, opts2] = mvn(['clean', 'package', '-DskipTests']);
        await run(cmd2, args2, opts2, 'backend build');
      }
      console.log('Building frontend bundle …');
      await run(npmCmd, ['ci'], { cwd: frontendDir, stdio: 'inherit', shell: isWin }, 'frontend install');
      await run(npmCmd, ['run', 'build'], { cwd: frontendDir, stdio: 'inherit', shell: isWin }, 'frontend build');
      console.log('\n✔ Build complete: backend/target/depositin-erp-1.0.0.jar + frontend/dist');
      break;
    }

    case 'start': {
      const jar = path.join(backendDir, 'target', 'depositin-erp-1.0.0.jar');
      if (!existsSync(jar)) {
        console.error('Jar not found. Run: npm run build');
        process.exit(1);
      }
      await run('java', ['-jar', jar], { cwd: backendDir, stdio: 'inherit' }, 'backend');
      break;
    }

    case 'test': {
      const [cmd, args, opts] = mvn(['test']);
      await run(cmd, args, opts, 'backend tests');
      break;
    }

    default:
      console.error(`Unknown task: ${task}\nUse: setup | dev | dev:backend | dev:frontend | build | start | test`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
