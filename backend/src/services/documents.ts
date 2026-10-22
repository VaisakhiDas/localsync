import type { DocumentDto, MemberDto } from '@localsync/shared';
import type { Role } from '@localsync/shared';
import type { Db } from '../db/pool';
import { withTransaction } from '../db/pool';

interface DocumentRow {
  id: string;
  title: string;
  role: Role;
  owner_name: string;
  created_at: Date;
  updated_at: Date;
}

const toDto = (row: DocumentRow): DocumentDto => ({
  id: row.id,
  title: row.title,
  role: row.role,
  ownerName: row.owner_name,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

// Every query below filters by the CALLER's membership: "no row" is how access is denied, and the
// same "no row" covers both "does not exist" and "not yours".
const SELECT_MINE = `
  SELECT d.id, d.title, d.created_at, d.updated_at, m.role, o.display_name AS owner_name
    FROM document_members m
    JOIN documents d ON d.id = m.document_id
    JOIN document_members om ON om.document_id = d.id AND om.role = 'owner'
    JOIN users o ON o.id = om.user_id
   WHERE m.user_id = $1`;

export async function listDocuments(db: Db, userId: string): Promise<DocumentDto[]> {
  const { rows } = await db.query<DocumentRow>(`${SELECT_MINE} ORDER BY d.updated_at DESC`, [userId]);
  return rows.map(toDto);
}

export async function getDocument(db: Db, userId: string, documentId: string): Promise<DocumentDto | null> {
  const { rows } = await db.query<DocumentRow>(`${SELECT_MINE} AND d.id = $2`, [userId, documentId]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function getRole(db: Db, userId: string, documentId: string): Promise<Role | null> {
  const { rows } = await db.query<{ role: Role }>(
    'SELECT role FROM document_members WHERE document_id = $1 AND user_id = $2',
    [documentId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Idempotent creation with a client-chosen id (so documents can be created offline and registered later).
 * Returns 'created', 'exists' (the caller already owns it: a safe retry), or 'taken' (someone else's id).
 */
export async function ensureDocument(db: Db, userId: string, documentId: string, title: string): Promise<'created' | 'exists' | 'taken'> {
  return withTransaction(db, async (tx) => {
    const inserted = await tx.query('INSERT INTO documents (id, title) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [documentId, title]);
    if (inserted.rowCount === 1) {
      await tx.query("INSERT INTO document_members (document_id, user_id, role) VALUES ($1, $2, 'owner')", [documentId, userId]);
      return 'created';
    }
    const owner = await tx.query("SELECT 1 FROM document_members WHERE document_id = $1 AND user_id = $2 AND role = 'owner'", [documentId, userId]);
    return owner.rowCount === 1 ? 'exists' : 'taken';
  });
}

export async function renameDocument(db: Db, documentId: string, title: string): Promise<void> {
  await db.query('UPDATE documents SET title = $2, updated_at = now() WHERE id = $1', [documentId, title]);
}

export async function deleteDocument(db: Db, documentId: string): Promise<void> {
  await db.query('DELETE FROM documents WHERE id = $1', [documentId]); // members and state cascade
}

export async function listMembers(db: Db, documentId: string): Promise<MemberDto[]> {
  const { rows } = await db.query<{ id: string; email: string; display_name: string; role: Role }>(
    `SELECT u.id, u.email, u.display_name, m.role
       FROM document_members m JOIN users u ON u.id = m.user_id
      WHERE m.document_id = $1
      ORDER BY (m.role = 'owner') DESC, lower(u.display_name)`,
    [documentId],
  );
  return rows.map((r) => ({ userId: r.id, email: r.email, displayName: r.display_name, role: r.role }));
}

export async function upsertMember(db: Db, documentId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
  await db.query(
    `INSERT INTO document_members (document_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [documentId, userId, role],
  );
}

export async function removeMember(db: Db, documentId: string, userId: string): Promise<void> {
  await db.query('DELETE FROM document_members WHERE document_id = $1 AND user_id = $2', [documentId, userId]);
}
