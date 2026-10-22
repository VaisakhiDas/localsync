/**
 * The backend as the Playwright end-to-end tests need it: a throwaway PostgreSQL in a temp
 * directory, migrations applied, the real server on E2E_BACKEND_PORT. Everything is deleted on exit.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config';
import { startEmbeddedPostgres } from '../src/db/embedded';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { createLogger } from '../src/logger';
import { createPgAuthorizer } from '../src/realtime/pgAuthorizer';
import { createPgPersistence } from '../src/realtime/pgPersistence';
import { startServer } from '../src/server';

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const dir = await mkdtemp(path.join(os.tmpdir(), 'localsync-e2e-'));
const pg = await startEmbeddedPostgres({ dataDir: dir, port: await freePort(), persistent: false });

const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: process.env.E2E_BACKEND_PORT ?? '4100',
  ALLOWED_ORIGINS: process.env.E2E_ORIGIN ?? 'http://localhost:4173',
  LOG_LEVEL: 'warn',
  DATABASE_URL: pg.url,
  SCRYPT_COST: '1024', // fast hashing for tests only
  AUTH_RATE_LIMIT_MAX: '1000',
  PERSIST_DEBOUNCE_MS: '100',
});
const log = createLogger(config.LOG_LEVEL);
const db = createPool(pg.url);
await runMigrations(db);
const server = await startServer({ config, log, db, authorizer: createPgAuthorizer(db), persistence: createPgPersistence(db, log, { autoVersionIntervalMs: config.AUTO_VERSION_INTERVAL_MS, autoVersionsKept: config.AUTO_VERSIONS_KEPT }) });
console.log(`e2e backend ready on :${server.port}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server.close();
  await db.end();
  await pg.stop();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
