import type { Role } from '@localsync/shared';

/** What the dashboard knows about a document. The body lives elsewhere (Yjs). */
export interface DocumentMeta {
  id: string;
  title: string;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  /** The current user's role on this document. */
  role: Role;
  /** For documents shared with this user: who owns it. */
  ownerName?: string;

  // --- sync bookkeeping (local-first metadata) -------------------------------------------------
  // Creating, renaming and deleting work offline against the local store; these flags record what
  // the server has not been told yet. (Document BODIES never need such flags: Yjs reconciles them.)

  /** The server has accepted this document. False for a document created offline until it is uploaded. */
  registered?: boolean;
  /** The title was changed locally and has not been sent yet. */
  titleDirty?: boolean;
  /**
   * The server no longer lists this document for us (the owner deleted it, or our access was removed).
   * We KEEP the local copy, read-only, until the user removes it: unsynced edits are never discarded silently.
   */
  revoked?: boolean;
  /** Deleted locally; hidden from every list. Removed for good once the server has been told. */
  deleted?: boolean;
}
