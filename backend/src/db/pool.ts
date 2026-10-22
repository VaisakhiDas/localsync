import pg from 'pg';

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client erroring (e.g. the database restarted) must not crash the process.
  pool.on('error', (err) => console.error(JSON.stringify({ level: 'error', message: 'idle database client error', error: err.message })));
  return pool;
}

/** Runs `fn` in a transaction: commit on success, roll back on any error. */
export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error code for a unique-constraint violation. */
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

export const isPgError = (err: unknown, code: string): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
