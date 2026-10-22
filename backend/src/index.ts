import { loadConfig, loadDotEnv } from './config';
import { createPool } from './db/pool';
import { runMigrations } from './db/migrate';
import { createLogger } from './logger';
import { createPgAuthorizer } from './realtime/pgAuthorizer';
import { createPgPersistence } from './realtime/pgPersistence';
import { startServer } from './server';

loadDotEnv(); // real environment variables always win over the file
const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

if (!config.DATABASE_URL) {
  log.error('DATABASE_URL is required. Copy .env.example to .env, or run `npm run dev:db` for a local PostgreSQL.');
  process.exit(1);
}

const db = createPool(config.DATABASE_URL);
await db.query('SELECT 1').catch((err: unknown) => {
  log.error('cannot reach PostgreSQL. Is it running? (try `npm run dev:db`)', { error: String(err) });
  process.exit(1);
});
if (process.env.AUTO_MIGRATE !== 'false') await runMigrations(db, log);

const running = await startServer({
  config,
  log,
  db,
  authorizer: createPgAuthorizer(db),
  persistence: createPgPersistence(db, log, { autoVersionIntervalMs: config.AUTO_VERSION_INTERVAL_MS, autoVersionsKept: config.AUTO_VERSIONS_KEPT }),
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  running
    .close()
    .then(() => db.end())
    .then(
      () => process.exit(0),
      (err: unknown) => {
        log.error('shutdown failed', { error: String(err) });
        process.exit(1);
      },
    );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
