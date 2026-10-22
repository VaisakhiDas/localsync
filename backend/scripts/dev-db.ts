/**
 * Starts a real PostgreSQL for local development (binaries come from the npm package
 * `embedded-postgres`; nothing is installed system-wide). Data persists in backend/.pgdata.
 * Leave it running in its own terminal; Ctrl+C stops it cleanly.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmbeddedPostgres } from '../src/db/embedded';

const port = Number(process.env.DEV_DB_PORT ?? 54320);
const dataDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '.pgdata');

const db = await startEmbeddedPostgres({ dataDir, port, persistent: true });
console.log(`PostgreSQL is running.\n  DATABASE_URL=${db.url}\n  data directory: ${dataDir}\nPress Ctrl+C to stop.`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30); // keep the process alive
