import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { DocumentMeta } from '../types/document';

/** Failures the UI can show to the user as-is. */
export class DocumentStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DocumentStoreError';
  }
}

/** Name of the Yjs shared type that holds the rich-text body (a Y.XmlFragment). */
export const CONTENT_FIELD = 'content';

/**
 * One open document body on this device: the Y.Doc plus whatever keeps it
 * durable locally. Owning the Y.Doc here (not in a React component) means the
 * same object can later be handed to the network provider.
 */
export interface LocalDocument {
  readonly id: string;
  readonly ydoc: Y.Doc;
  /**
   * Presence (who is here, where their cursor is). Ephemeral: never persisted, never part of the
   * document. It is owned by the document so it exists before the editor is built and is torn
   * down with it, independent of whether a network connection exists.
   */
  readonly awareness: Awareness;
  /**
   * Resolves once everything stored on this device has been loaded into `ydoc`.
   * Nothing (editor, network provider) should touch the doc before this, so an
   * empty first render can never be mistaken for "the document is empty".
   * Rejects if local storage is unusable.
   */
  readonly ready: Promise<void>;
  /** Failures that happen *after* load, e.g. the device runs out of storage. */
  onStorageError(listener: (error: DocumentStoreError) => void): () => void;
  /** Releases handles and destroys the Y.Doc. Never deletes stored data. */
  destroy(): void;
}

/**
 * Where document *metadata* (title, timestamps, role) lives and how document
 * *bodies* are opened. Keeping metadata apart from bodies means listing or
 * renaming never has to load a Yjs document.
 */
export interface DocumentStore {
  list(): Promise<DocumentMeta[]>;
  get(id: string): Promise<DocumentMeta | undefined>;
  create(): Promise<DocumentMeta>;
  rename(id: string, title: string): Promise<DocumentMeta>;
  /** Bumps `updatedAt` (called when the body changes). Resolves undefined if the document is gone. */
  touch(id: string): Promise<DocumentMeta | undefined>;
  /** Deletes metadata and the locally stored body. */
  remove(id: string): Promise<void>;
  /** Opens the body for editing. The caller must `destroy()` it. */
  openContent(id: string): LocalDocument;
  /** Called when *another tab* changed the store. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  // --- used by the metadata sync engine only -------------------------------------------------
  /** Every record including deletion tombstones. */
  listAll(): Promise<DocumentMeta[]>;
  /**
   * Atomic read-modify-write of one record. Return the new record, or null to leave it unchanged.
   * Atomicity matters: a rename typed while an upload is in flight must not be overwritten by the
   * upload's result. Does not touch `updatedAt`. Resolves undefined if the record is gone.
   */
  updateMeta(id: string, update: (current: DocumentMeta) => DocumentMeta | null): Promise<DocumentMeta | undefined>;
  /** Inserts a record received from the server unless one already exists locally. Resolves true if it inserted. */
  insertIfAbsent(doc: DocumentMeta): Promise<boolean>;
  /** Hard-deletes the record and its local body (no tombstone). */
  purge(id: string): Promise<void>;
  /** Deletes EVERYTHING this store holds. Used by "sign out and remove local data". */
  wipe(): Promise<void>;
}

/** Records the user can see: everything except tombstones. */
export const isVisible = (doc: DocumentMeta): boolean => !doc.deleted;

/** Most recently edited first. */
export const byRecentlyUpdated = (a: DocumentMeta, b: DocumentMeta): number => b.updatedAt - a.updatedAt;
