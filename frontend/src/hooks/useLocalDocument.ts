import { useEffect, useState } from 'react';
import type { DocumentStore, LocalDocument } from '../lib/documentStore';

export type LocalDocumentState =
  | { status: 'loading' }
  | { status: 'ready'; doc: LocalDocument; storageError: string | null }
  | { status: 'error'; error: string };

type Opened = { doc: LocalDocument } | { error: string } | null;

/**
 * Opens a document body from local storage and keeps it open for the lifetime of the component.
 * Remount with a different `key` to open another document (or to retry after an error).
 *
 * Status is `ready` only after every locally stored update has been loaded into the Y.Doc.
 */
export function useLocalDocument(store: DocumentStore, id: string): LocalDocumentState {
  const [opened, setOpened] = useState<Opened>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const doc = store.openContent(id);
    let ignore = false; // React StrictMode runs effects twice; only the live run may set state
    doc.ready.then(
      () => !ignore && setOpened({ doc }),
      (err: unknown) => !ignore && setOpened({ error: err instanceof Error ? err.message : 'Could not open this document.' }),
    );
    const stopListening = doc.onStorageError((e) => !ignore && setStorageError(e.message));
    return () => {
      ignore = true;
      stopListening();
      doc.destroy();
    };
  }, [store, id]);

  if (!opened) return { status: 'loading' };
  if ('error' in opened) return { status: 'error', error: opened.error };
  return { status: 'ready', doc: opened.doc, storageError };
}
