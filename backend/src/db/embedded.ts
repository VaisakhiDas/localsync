import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

export interface EmbeddedDb {
  /** postgres://... connection string for the created database. */
  url: string;
  stop(): Promise<void>;
}

/**
 * A real PostgreSQL server started from binaries shipped via npm (the `embedded-postgres`
 * package): no system install, no Docker. Used for local development and for tests.
 * In production point DATABASE_URL at a normal PostgreSQL instead.
 */
export async function startEmbeddedPostgres(options: {
  dataDir: string;
  port: number;
  database?: string;
  /** false: the data directory is deleted on stop (tests). true: kept between runs (development). */
  persistent: boolean;
  verbose?: boolean;
}): Promise<EmbeddedDb> {
  const user = 'localsync';
  const password = 'localsync-dev-only';
  const database = options.database ?? 'localsync';
  const pg = new EmbeddedPostgres({
    databaseDir: options.dataDir,
    port: options.port,
    user,
    password,
    persistent: options.persistent,
    onLog: options.verbose ? (m) => console.log(String(m).trim()) : () => undefined,
    onError: (m) => {
      const text = String(m).trim();
      if (options.verbose || /\b(FATAL|PANIC)\b/.test(text)) console.error(text);
    },
  });

  if (!existsSync(path.join(options.dataDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch (err) {
    // Re-running against an existing persistent data directory: the database is already there.
    if (!/already exists/i.test(String(err))) throw err;
  }

  return {
    url: `postgres://${user}:${password}@127.0.0.1:${options.port}/${database}`,
    stop: () => pg.stop(),
  };
}
