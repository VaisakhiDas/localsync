import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool';
import type { Logger } from '../logger';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Arbitrary constant; serialises concurrent migrators (e.g. two server instances starting together). */
const LOCK_ID = 7_351_204;

interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

async function readMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const [version = '', ...rest] = file.replace(/\.sql$/, '').split('_');
      return { version, name: rest.join('_'), sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/**
 * Applies every migration that has not run yet, in order, each in its own transaction.
 * Safe to run repeatedly. Refuses to continue if an already-applied migration file was edited
 * (schema history must be append-only: write a new migration instead).
 */
export async function runMigrations(db: Db, log?: Logger, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Map<string, string>(
      (await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]),
    );

    for (const migration of await readMigrations(dir)) {
      const existing = done.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(`Migration ${migration.version}_${migration.name} was modified after it was applied. Add a new migration instead.`);
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [migration.version, migration.name, migration.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${migration.version}_${migration.name} failed: ${(err as Error).message}`);
      }
      applied.push(`${migration.version}_${migration.name}`);
      log?.info('applied migration', { migration: `${migration.version}_${migration.name}` });
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
