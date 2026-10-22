import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { createPool } from './pool';

const adminUrl = inject('pgUrl');
const created: string[] = [];

/** A database with no migrations applied at all. */
async function blankDatabase() {
  const name = `m_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  created.push(name);
  return createPool(adminUrl.replace(/\/[^/]*$/, `/${name}`));
}

afterAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe('migrations', () => {
  it('create the documented schema and are idempotent', async () => {
    const db = await blankDatabase();
    const first = await runMigrations(db);
    expect(first).toEqual(expect.arrayContaining(['001_initial']));
    expect(await runMigrations(db)).toEqual([]); // nothing left to do

    const { rows } = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    for (const table of ['users', 'sessions', 'documents', 'document_members', 'document_states', 'schema_migrations']) {
      expect(rows.map((r) => r.table_name)).toContain(table);
    }
    await db.end();
  });

  it('refuse to continue if an applied migration file was edited afterwards', async () => {
    const db = await blankDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'migrations-'));
    try {
      await writeFile(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id int);');
      await runMigrations(db, undefined, dir);
      await writeFile(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id int, sneaky int);');
      await expect(runMigrations(db, undefined, dir)).rejects.toThrow(/modified after it was applied/);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await db.end();
    }
  });

  it('apply each migration atomically: a failure leaves no half-applied schema and no record', async () => {
    const db = await blankDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'migrations-'));
    try {
      await writeFile(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok (id int);');
      await writeFile(path.join(dir, '002_bad.sql'), 'CREATE TABLE half (id int); SELECT * FROM does_not_exist;');
      await expect(runMigrations(db, undefined, dir)).rejects.toThrow(/002_bad failed/);

      const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name);
      expect(tables).toContain('ok');
      expect(tables).not.toContain('half'); // rolled back together with the failing statement
      const recorded = (await db.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version);
      expect(recorded).toEqual(['001']);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await db.end();
    }
  });
});
