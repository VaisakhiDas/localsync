import type { CommentDto } from '@localsync/shared';
import type { Db } from '../db/pool';

interface CommentRow {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  quote: string | null;
  resolved: boolean;
  created_at: Date;
}

const toDto = (r: CommentRow): CommentDto => ({
  id: r.id,
  authorId: r.author_id ?? '',
  authorName: r.author_name ?? 'Former member',
  body: r.body,
  quote: r.quote,
  resolved: r.resolved,
  createdAt: r.created_at.toISOString(),
});

const SELECT = `SELECT c.id, c.author_id, u.display_name AS author_name, c.body, c.quote, c.resolved, c.created_at
                  FROM comments c LEFT JOIN users u ON u.id = c.author_id`;

export async function listComments(db: Db, documentId: string): Promise<CommentDto[]> {
  const { rows } = await db.query<CommentRow>(`${SELECT} WHERE c.document_id = $1 ORDER BY c.created_at`, [documentId]);
  return rows.map(toDto);
}

export async function getComment(db: Db, documentId: string, commentId: string): Promise<CommentDto | null> {
  const { rows } = await db.query<CommentRow>(`${SELECT} WHERE c.document_id = $1 AND c.id = $2`, [documentId, commentId]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function createComment(db: Db, documentId: string, authorId: string, body: string, quote: string | undefined): Promise<CommentDto> {
  const { rows } = await db.query<{ id: string }>('INSERT INTO comments (document_id, author_id, body, quote) VALUES ($1, $2, $3, $4) RETURNING id', [documentId, authorId, body, quote?.trim() || null]);
  return (await getComment(db, documentId, rows[0]!.id))!;
}

export async function setResolved(db: Db, documentId: string, commentId: string, resolved: boolean): Promise<void> {
  await db.query('UPDATE comments SET resolved = $3 WHERE document_id = $1 AND id = $2', [documentId, commentId, resolved]);
}

export async function deleteComment(db: Db, documentId: string, commentId: string): Promise<void> {
  await db.query('DELETE FROM comments WHERE document_id = $1 AND id = $2', [documentId, commentId]);
}
