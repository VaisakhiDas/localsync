import type { IncomingMessage } from 'node:http';
import type { Role } from '@localsync/shared';

/** Who is connecting and what they may do. Always derived on the server, never taken from the client. */
export interface DocumentAccess {
  userId: string;
  displayName: string;
  role: Role;
  /** The login session this connection belongs to (so logging out can drop its sockets). */
  sessionId?: string;
}

export type AuthResult =
  | { ok: true; access: DocumentAccess }
  | { ok: false; code: 4401 | 4403; reason: string };

/**
 * Decides whether this HTTP upgrade request may open this document.
 * Implementations MUST answer "forbidden" both for documents that do not exist and for
 * documents the caller is not a member of, so ids cannot be probed.
 */
export interface Authorizer {
  authorize(request: IncomingMessage, documentId: string): Promise<AuthResult>;
}

/** Durable storage for the merged Yjs state of each document (a single encoded update). */
export interface DocumentPersistence {
  load(documentId: string): Promise<Uint8Array | null>;
  store(documentId: string, state: Uint8Array): Promise<void>;
}
