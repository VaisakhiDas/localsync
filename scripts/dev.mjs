#!/usr/bin/env node
/**
 * `npm run dev`: starts everything needed for local development, with no setup.
 *   1. a real PostgreSQL (binaries from the `embedded-postgres` npm package; data in backend/.pgdata)
 *   2. the backend (applies migrations on start)
 *   3. the Vite dev server (proxies /api and /collab to the backend)
 * Ctrl+C stops all three, PostgreSQL last and cleanly.
 */
import { spawn } from 'node:child_process';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://localsync:localsync-dev-only@127.0.0.1:54320/localsync';
const colors = { db: '\x1b[35m', api: '\x1b[36m', web: '\x1b[33m' };
const children = [];

function run(name, args, env = {}) {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, detached: false });
  const prefix = `${colors[name]}[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split('\n').filter(Boolean)) console.log(prefix + line);
    });
  }
  children.push(child);
  return child;
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Stop the web and API first, then PostgreSQL (it needs SIGINT to shut down cleanly).
  for (const child of children.slice().reverse()) child.kill('SIGINT');
  setTimeout(() => process.exit(code), 4000).unref();
  Promise.all(children.map((c) => new Promise((resolve) => (c.exitCode !== null ? resolve() : c.once('exit', resolve))))).then(() => process.exit(code));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const db = run('db', ['run', 'dev:db', '-w', 'backend']);
db.on('exit', (code) => {
  if (!stopping) {
    console.error(`PostgreSQL exited unexpectedly (code ${code}).`);
    stop(1);
  }
});

let started = false;
db.stdout.on('data', (chunk) => {
  if (started || !String(chunk).includes('PostgreSQL is running')) return;
  started = true;
  const api = run('api', ['run', 'dev', '-w', 'backend'], { DATABASE_URL: DB_URL });
  api.on('exit', (code) => !stopping && (console.error(`Backend exited (code ${code}).`), stop(1)));
  run('web', ['run', 'dev:frontend']);
  console.log('\nOpen http://localhost:5173  (first time? run `npm run seed` in another terminal for demo accounts)\n');
});
