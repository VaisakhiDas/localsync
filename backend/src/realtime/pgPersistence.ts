import type { Db } from '../db/pool';
import { FOREIGN_KEY_VIOLATION, isPgError, withTransaction } from '../db/pool';
import type { Logger } from '../logger';
import { maybeCreateAutoVersion } from '../services/versions';
import type { DocumentPersistence } from './types';

/** Stores each document's merged Yjs state as one bytea row (see migration 001). */
export interface PgPersistenceOptions {
  autoVersionIntervalMs: number;
  autoVersionsKept: number;
}

export function createPgPersistence(db: Db, log: Logger, options: PgPersistenceOptions = { autoVersionIntervalMs: 10 * 60_000, autoVersionsKept: 50 }): DocumentPersistence {
  return {
    async load(documentId) {
      const { rows } = await db.query<{ state: Buffer }>('SELECT state FROM document_states WHERE document_id = $1', [documentId]);
      return rows[0] ? new Uint8Array(rows[0].state) : null;
    },

    async store(documentId, state) {
      try {
        await withTransaction(db, async (tx) => {
          await tx.query(
            `INSERT INTO document_states (document_id, state, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (document_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
            [documentId, Buffer.from(state)],
          );
          // The dashboard orders by "last edited".
          await tx.query('UPDATE documents SET updated_at = now() WHERE id = $1', [documentId]);
          await maybeCreateAutoVersion(tx, documentId, state, options.autoVersionIntervalMs, options.autoVersionsKept);
        });
      } catch (err) {
        // The document was deleted while its room was still flushing: nothing to save, not an error.
        if (isPgError(err, FOREIGN_KEY_VIOLATION)) {
          log.warn('skipped saving a deleted document', { documentId });
          return;
        }
        throw err;
      }
    },
  };
}
