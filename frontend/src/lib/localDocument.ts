import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DocumentStoreError, type LocalDocument } from './documentStore';
import { describeStorageFailure, isIndexedDbFailure } from './storageErrors';

/** How long we wait for IndexedDB before telling the user storage is not responding. */
const LOAD_TIMEOUT_MS = 10_000;

/** y-indexeddb keeps its open-connection promise on `_db`; it is the only way to observe an open failure. */
const openPromiseOf = (p: IndexeddbPersistence): Promise<unknown> | undefined => {
  const db = (p as unknown as { _db?: unknown })._db;
  return db instanceof Promise ? db : undefined;
};

/**
 * One Y.Doc per document, persisted in its own IndexedDB database via y-indexeddb.
 *
 * Why this matters for offline-first: every local edit is appended to IndexedDB
 * as a Yjs update *before* any network is involved, and on the next load those
 * updates are replayed into a fresh Y.Doc. The browser, not the server, is the
 * first place your data lives.
 */
export function openIndexedDbDocument(id: string, dbName: string): LocalDocument {
  const ydoc = new Y.Doc({ guid: id });
  const persistence = new IndexeddbPersistence(dbName, ydoc);
  const awareness = new Awareness(ydoc); // destroyed automatically with the Y.Doc
  const listeners = new Set<(error: DocumentStoreError) => void>();
  let destroyed = false;

  const report = (cause: unknown) => {
    if (destroyed) return;
    const error = new DocumentStoreError(describeStorageFailure(cause), { cause });
    listeners.forEach((listener) => listener(error));
  };

  // y-indexeddb persists each update fire-and-forget, so a failed write (quota
  // exceeded, database evicted) only shows up as an unhandled rejection. We turn
  // those into a visible error instead of letting the UI claim everything is saved.
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isIndexedDbFailure(event.reason)) return;
    event.preventDefault();
    report(event.reason);
  };
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DocumentStoreError('Local storage is not responding. Close other tabs of this app and reload.')),
      LOAD_TIMEOUT_MS,
    );
    void persistence.whenSynced.then(() => {
      clearTimeout(timer);
      resolve();
    });
    // If the database cannot be opened, `whenSynced` never resolves: fail explicitly.
    openPromiseOf(persistence)?.catch((cause: unknown) => {
      clearTimeout(timer);
      reject(new DocumentStoreError(describeStorageFailure(cause), { cause }));
    });
  });

  return {
    id,
    ydoc,
    awareness,
    ready,
    onStorageError(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      listeners.clear();
      // Pending IndexedDB transactions finish before the connection closes. destroy() rejects if the
      // database never opened; that failure was already reported through `ready`.
      persistence.destroy().catch(() => undefined);
      ydoc.destroy();
    },
  };
}
