import { DEFAULT_TITLE, normalizeTitle } from '@localsync/shared';
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocumentMeta } from '../types/document';
import { byRecentlyUpdated, DocumentStoreError, isVisible, type DocumentStore } from './documentStore';
import { newId } from './id';
import { openIndexedDbDocument } from './localDocument';
import { describeStorageFailure } from './storageErrors';

interface MetaDB extends DBSchema {
  documents: {
    key: string;
    value: DocumentMeta;
    indexes: { 'by-updated': number };
  };
}

const DB_VERSION = 1;

export interface IdbDocumentStoreOptions {
  /**
   * Isolates one user's local data from another's on a shared browser profile.
   * It prefixes every IndexedDB database name this store touches.
   */
  namespace?: string;
}

export function createIndexedDbDocumentStore({ namespace = 'local' }: IdbDocumentStoreOptions = {}): DocumentStore {
  const metaName = `localsync:${namespace}:meta`;
  const contentName = (id: string) => `localsync:${namespace}:doc:${id}`;

  const listeners = new Set<() => void>();
  // Created lazily so that constructing a store (e.g. during a React render) has no side effects.
  // BroadcastChannel never delivers to the sender, so listeners only hear about OTHER tabs.
  let channel: BroadcastChannel | null = null;
  const getChannel = () => {
    if (typeof BroadcastChannel === 'undefined') return null;
    channel ??= new BroadcastChannel(`${metaName}:changes`);
    return channel;
  };
  const announce = () => getChannel()?.postMessage('changed');
  const notifyAll = () => listeners.forEach((l) => l());

  let dbPromise: Promise<IDBPDatabase<MetaDB>> | null = null;
  const getDb = () => {
    dbPromise ??= openDB<MetaDB>(metaName, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('documents', { keyPath: 'id' }).createIndex('by-updated', 'updatedAt');
      },
      // Another tab wants to upgrade or delete the database: step aside, reopen lazily.
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((err: unknown) => {
      dbPromise = null; // let "Retry" try again instead of caching the failure
      throw err;
    });
    return dbPromise;
  };

  /** Runs a DB operation and turns any IndexedDB failure into a message the user can read. */
  async function guard<T>(operation: (db: IDBPDatabase<MetaDB>) => Promise<T>): Promise<T> {
    try {
      return await operation(await getDb());
    } catch (err) {
      if (err instanceof DocumentStoreError) throw err;
      throw new DocumentStoreError(describeStorageFailure(err), { cause: err });
    }
  }

  const store: DocumentStore = {
    list: () => guard(async (db) => (await db.getAll('documents')).filter(isVisible).sort(byRecentlyUpdated)),

    get: (id) =>
      guard(async (db) => {
        const doc = await db.get('documents', id);
        return doc && isVisible(doc) ? doc : undefined;
      }),

    create: () =>
      guard(async (db) => {
        const now = Date.now();
        // The id is generated here, on the device, so creating a document never needs a network round trip.
        const doc: DocumentMeta = { id: newId(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, role: 'owner', registered: false };
        await db.put('documents', doc);
        announce();
        // Ask the browser not to evict our data under storage pressure (best effort, no prompt in most browsers).
        void navigator.storage?.persist?.().catch(() => undefined);
        return doc;
      }),

    rename: (id, title) =>
      guard(async (db) => {
        const tx = db.transaction('documents', 'readwrite');
        const existing = await tx.store.get(id);
        if (!existing || existing.deleted) throw new DocumentStoreError('Document not found.');
        const next: DocumentMeta = { ...existing, title: normalizeTitle(title), titleDirty: true, updatedAt: Date.now() };
        await tx.store.put(next);
        await tx.done;
        announce();
        return next;
      }),

    touch: (id) =>
      guard(async (db) => {
        const tx = db.transaction('documents', 'readwrite');
        const existing = await tx.store.get(id);
        if (!existing || existing.deleted) return undefined;
        const next: DocumentMeta = { ...existing, updatedAt: Date.now() };
        await tx.store.put(next);
        await tx.done;
        announce();
        return next;
      }),

    remove: (id) =>
      guard(async (db) => {
        const tx = db.transaction('documents', 'readwrite');
        const existing = await tx.store.get(id);
        if (!existing || existing.deleted) throw new DocumentStoreError('Document not found.');
        if (existing.registered && !existing.revoked) {
          // The server must still be told: keep a hidden tombstone until it has been.
          await tx.store.put({ ...existing, deleted: true });
          await tx.done;
          announce();
        } else {
          await tx.done;
          await store.purge(id);
        }
      }),

    openContent: (id) => openIndexedDbDocument(id, contentName(id)),

    subscribe(listener) {
      if (listeners.size === 0) getChannel()?.addEventListener('message', notifyAll);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) channel?.removeEventListener('message', notifyAll);
      };
    },

    listAll: () => guard((db) => db.getAll('documents')),

    updateMeta: (id, update) =>
      guard(async (db) => {
        const tx = db.transaction('documents', 'readwrite');
        const current = await tx.store.get(id);
        if (!current) return undefined;
        const next = update(current);
        if (next) await tx.store.put(next);
        await tx.done;
        if (next) announce();
        return next ?? current;
      }),

    insertIfAbsent: (doc) =>
      guard(async (db) => {
        const tx = db.transaction('documents', 'readwrite');
        const inserted = !(await tx.store.get(doc.id));
        if (inserted) await tx.store.put(doc);
        await tx.done;
        if (inserted) announce();
        return inserted;
      }),

    purge: (id) =>
      guard(async (db) => {
        await db.delete('documents', id);
        announce();
        void deleteDB(contentName(id), { blocked() {} }).catch(() => undefined);
      }),

    wipe: async () => {
      // Close our own handle first, or deleting our own database would wait on ourselves.
      const open = dbPromise;
      dbPromise = null;
      (await open?.catch(() => undefined))?.close();
      const prefix = `localsync:${namespace}:`;
      const names = (await indexedDB.databases?.())?.map((d) => d.name ?? '').filter((n) => n.startsWith(prefix)) ?? [];
      await Promise.all(names.map((name) => deleteDB(name, { blocked() {} }).catch(() => undefined)));
      announce();
    },
  };
  return store;
}
