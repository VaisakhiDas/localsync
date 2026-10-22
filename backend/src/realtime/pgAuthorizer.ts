import { parse as parseCookie } from 'cookie';
import { CloseCode, isDocumentId, isRole } from '@localsync/shared';
import type { Db } from '../db/pool';
import { findSession, SESSION_COOKIE } from '../services/sessions';
import type { Authorizer } from './types';

const FORBIDDEN = { ok: false, code: CloseCode.Forbidden, reason: 'Access denied' } as const;

/**
 * The real authorizer. Identity comes from the session cookie the browser attached to the
 * upgrade request; the role comes from the document_members table. Nothing the client says
 * (query string, headers, message contents) can raise its own privileges.
 *
 * "No such document" and "not your document" produce the same answer on purpose.
 */
export function createPgAuthorizer(db: Db): Authorizer {
  return {
    async authorize(request, documentId) {
      if (!isDocumentId(documentId)) return FORBIDDEN;

      const token = parseCookie(request.headers.cookie ?? '')[SESSION_COOKIE];
      const auth = token ? await findSession(db, token) : null;
      if (!auth) return { ok: false, code: CloseCode.Unauthenticated, reason: 'Authentication required' };

      const { rows } = await db.query<{ role: string }>(
        'SELECT role FROM document_members WHERE document_id = $1 AND user_id = $2',
        [documentId, auth.user.id],
      );
      const role = rows[0]?.role;
      if (!isRole(role)) return FORBIDDEN;

      return {
        ok: true,
        access: { userId: auth.user.id, displayName: auth.user.displayName, role, sessionId: auth.sessionId },
      };
    },
  };
}
