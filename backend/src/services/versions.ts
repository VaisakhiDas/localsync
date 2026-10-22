import type { VersionDto } from '@localsync/shared';
import type { Db, Queryable } from '../db/pool';

interface VersionRow {
  id: string;
  label: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  size_bytes: number;
}

const toDto = (row: VersionRow): VersionDto => ({
  id: row.id,
  label: row.label,
  createdById: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at.toISOString(),
  sizeBytes: row.size_bytes,
});

export async function listVersions(db: Db, documentId: string): Promise<VersionDto[]> {
  const { rows } = await db.query<VersionRow>(
    `SELECT v.id, v.label, v.created_by, u.display_name AS created_by_name, v.created_at, v.size_bytes
       FROM document_versions v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.document_id = $1
      ORDER BY v.created_at DESC
      LIMIT 200`,
    [documentId],
  );
  return rows.map(toDto);
}

/** The frozen state of one version, scoped by document so an id from another document is "not found". */
export async function getVersionState(db: Db, documentId: string, versionId: string): Promise<Buffer | null> {
  const { rows } = await db.query<{ state: Buffer }>('SELECT state FROM document_versions WHERE id = $1 AND document_id = $2', [versionId, documentId]);
  return rows[0]?.state ?? null;
}

export async function createManualVersion(db: Db, documentId: string, userId: string, label: string | undefined, state: Uint8Array): Promise<VersionDto> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO document_versions (document_id, created_by, kind, label, state, size_bytes)
     VALUES ($1, $2, 'manual', $3, $4, $5) RETURNING id`,
    [documentId, userId, label?.trim() || null, Buffer.from(state), state.byteLength],
  );
  const created = (await listVersions(db, documentId)).find((v) => v.id === rows[0]!.id);
  return created!;
}

/**
 * Called while saving a document: adds an automatic checkpoint if the newest version is old enough.
 * Runs inside the persistence transaction so a checkpoint and the state it captured are saved together.
 */
export async function maybeCreateAutoVersion(tx: Queryable, documentId: string, state: Uint8Array, intervalMs: number, keep: number): Promise<void> {
  const { rows } = await tx.query<{ due: boolean }>(
    `SELECT (max(created_at) IS NULL OR max(created_at) < now() - ($2::bigint * interval '1 millisecond')) AS due
       FROM document_versions WHERE document_id = $1`,
    [documentId, intervalMs],
  );
  if (!rows[0]?.due) return;
  await tx.query(
    `INSERT INTO document_versions (document_id, created_by, kind, state, size_bytes) VALUES ($1, NULL, 'auto', $2, $3)`,
    [documentId, Buffer.from(state), state.byteLength],
  );
  // Keep the history bounded: prune the OLDEST automatic checkpoints. Saved versions are never auto-deleted.
  await tx.query(
    `DELETE FROM document_versions WHERE id IN (
       SELECT id FROM document_versions WHERE document_id = $1 AND kind = 'auto' ORDER BY created_at DESC OFFSET $2)`,
    [documentId, keep],
  );
}
