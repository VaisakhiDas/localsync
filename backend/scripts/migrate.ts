import { loadConfig, loadDotEnv } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { createLogger } from '../src/logger';

loadDotEnv();
const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const db = createPool(config.DATABASE_URL);
try {
  const applied = await runMigrations(db, createLogger('info'));
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
} finally {
  await db.end();
}
