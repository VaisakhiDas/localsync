import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { runMigrations } from '../db/migrate';
import { createPool, type Db } from '../db/pool';

/** A fresh, fully migrated database (inside the shared test PostgreSQL) that only this test file uses. */
export async function createTestDatabase(): Promise<{ db: Db; url: string; drop(): Promise<void> }> {
  const adminUrl = inject('pgUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = adminUrl.replace(/\/[^/]*$/, `/${name}`);
  const db = createPool(url);
  await runMigrations(db);
  return {
    db,
    url,
    async drop() {
      await db.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}
