import { createHash, randomBytes } from 'node:crypto';
import type { UserDto } from '@localsync/shared';
import type { Db } from '../db/pool';

export const SESSION_COOKIE = 'ls_session';

export interface AuthContext {
  user: UserDto;
  sessionId: string;
}

/** The database only ever sees this hash, so a leaked table does not leak usable cookies. */
export const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

export async function createSession(db: Db, userId: string, ttlDays: number, userAgent: string | undefined) {
  const token = randomBytes(32).toString('base64url'); // 256 bits of entropy
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO sessions (user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, hashToken(token), expiresAt, userAgent?.slice(0, 300) ?? null],
  );
  // Opportunistic cleanup keeps the table small without a scheduled job.
  void db.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => undefined);
  return { token, expiresAt, sessionId: rows[0]!.id };
}

export async function findSession(db: Db, token: string): Promise<AuthContext | null> {
  const { rows } = await db.query<{ session_id: string; id: string; email: string; display_name: string }>(
    `SELECT s.id AS session_id, u.id, u.email, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row ? { sessionId: row.session_id, user: { id: row.id, email: row.email, displayName: row.display_name } } : null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
