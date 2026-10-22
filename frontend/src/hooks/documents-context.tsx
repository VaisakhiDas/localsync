import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DocumentStore } from '../lib/documentStore';
import type { MetadataSync, MetadataSyncState } from '../lib/metadataSync';
import { byRecentlyUpdated } from '../lib/documentStore';
import type { DocumentMeta } from '../types/document';

type LoadStatus = 'loading' | 'ready' | 'error';

interface DocumentsContextValue {
  /** The underlying store; the editor uses it to open document bodies. */
  store: DocumentStore;
  /** Whether document metadata is currently in step with the server. */
  metadataSync: MetadataSyncState;
  documents: DocumentMeta[];
  /** Status of the initial list load. Action failures use `actionError` instead. */
  status: LoadStatus;
  loadError: string | null;
  actionError: string | null;
  dismissActionError: () => void;
  reload: () => Promise<void>;
  create: () => Promise<DocumentMeta | null>;
  rename: (id: string, title: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Ask for a metadata sync soon (roles, titles, list). Cheap to call: bursts collapse into one pass. */
  requestSync: () => void;
  /** Marks a document as just edited (reorders the list). Failures are non-fatal and ignored. */
  touch: (id: string) => Promise<void>;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const NO_SYNC_SUBSCRIBE = () => () => undefined;
const NO_SYNC_STATE = (): MetadataSyncState => 'idle';

export function DocumentsProvider({ store, syncer, children }: { store: DocumentStore; syncer?: MetadataSync; children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bumping this re-runs the load effect (used by "Retry").
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false; // guards against a stale response after unmount / store change
    store.list().then(
      (list) => {
        if (ignore) return;
        setDocuments(list);
        setLoadError(null);
        setStatus('ready');
      },
      (err: unknown) => {
        if (ignore) return;
        setLoadError(messageOf(err, 'Could not load your documents.'));
        setStatus('error');
      },
    );
    return () => {
      ignore = true;
    };
  }, [store, reloadToken]);

  // The server round trip changed local records (shared documents arrived, titles updated...).
  useEffect(() => syncer?.onChanged(() => setReloadToken((t) => t + 1)), [syncer]);
  const metadataSync = useSyncExternalStore(syncer?.subscribe ?? NO_SYNC_SUBSCRIBE, syncer?.getSnapshot ?? NO_SYNC_STATE);

  // Another tab created/renamed/deleted something: refresh quietly (no loading flash).
  useEffect(() => store.subscribe(() => setReloadToken((t) => t + 1)), [store]);

  const requestSync = useCallback(() => syncer?.requestSync(0), [syncer]);

  const reload = useCallback(async () => {
    setStatus('loading');
    setReloadToken((t) => t + 1);
  }, []);

  const upsert = useCallback((doc: DocumentMeta) => {
    setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)].sort(byRecentlyUpdated));
  }, []);

  const value = useMemo<DocumentsContextValue>(
    () => ({
      store,
      metadataSync,
      documents,
      status,
      loadError,
      actionError,
      dismissActionError: () => setActionError(null),
      reload,
      requestSync,
      async create() {
        try {
          const doc = await store.create();
          upsert(doc);
          syncer?.requestSync();
          setActionError(null);
          return doc;
        } catch (err) {
          setActionError(messageOf(err, 'Could not create the document.'));
          return null;
        }
      },
      async rename(id, title) {
        try {
          upsert(await store.rename(id, title));
          syncer?.requestSync();
          setActionError(null);
          return true;
        } catch (err) {
          setActionError(messageOf(err, 'Could not rename the document.'));
          return false;
        }
      },
      async touch(id) {
        try {
          const doc = await store.touch(id);
          if (doc) upsert(doc);
        } catch {
          // Reordering the list is cosmetic; a real storage failure is reported by the open document.
        }
      },
      async remove(id) {
        try {
          await store.remove(id);
          setDocuments((prev) => prev.filter((d) => d.id !== id));
          syncer?.requestSync();
          setActionError(null);
          return true;
        } catch (err) {
          setActionError(messageOf(err, 'Could not delete the document.'));
          return false;
        }
      },
    }),
    [documents, status, loadError, actionError, metadataSync, reload, requestSync, store, syncer, upsert],
  );

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

export function useDocuments(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocuments must be used inside <DocumentsProvider>');
  return ctx;
}
