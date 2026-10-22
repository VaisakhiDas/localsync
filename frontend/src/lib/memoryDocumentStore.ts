import { DEFAULT_TITLE, normalizeTitle } from '@localsync/shared';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { DocumentMeta } from '../types/document';
import { byRecentlyUpdated, DocumentStoreError, isVisible, type DocumentStore, type LocalDocument } from './documentStore';
import { newId } from './id';

/**
 * Volatile store for unit tests. Bodies are kept as encoded Yjs updates between
 * `openContent` calls so tests can exercise "close and reopen a document".
 */
export function createMemoryDocumentStore(seed: DocumentMeta[] = []): DocumentStore {
  const docs = new Map(seed.map((d) => [d.id, d]));
  const bodies = new Map<string, Uint8Array>();
  const listeners = new Set<() => void>();
  const need = (id: string): DocumentMeta => {
    const doc = docs.get(id);
    if (!doc || doc.deleted) throw new DocumentStoreError('Document not found.');
    return doc;
  };

  const store: DocumentStore = {
    async list() {
      return [...docs.values()].filter(isVisible).sort(byRecentlyUpdated);
    },
    async get(id) {
      const doc = docs.get(id);
      return doc && isVisible(doc) ? doc : undefined;
    },
    async create() {
      const now = Date.now();
      const doc: DocumentMeta = { id: newId(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, role: 'owner', registered: false };
      docs.set(doc.id, doc);
      return doc;
    },
    async rename(id, title) {
      const next = { ...need(id), title: normalizeTitle(title), titleDirty: true, updatedAt: Date.now() };
      docs.set(id, next);
      return next;
    },
    async touch(id) {
      const doc = docs.get(id);
      if (!doc || doc.deleted) return undefined;
      const next = { ...doc, updatedAt: Date.now() };
      docs.set(id, next);
      return next;
    },
    async remove(id) {
      const doc = need(id);
      if (doc.registered && !doc.revoked) docs.set(id, { ...doc, deleted: true }); // the server must still be told
      else await store.purge(id);
    },
    openContent(id): LocalDocument {
      const ydoc = new Y.Doc({ guid: id });
      const saved = bodies.get(id);
      if (saved) Y.applyUpdate(ydoc, saved);
      return {
        id,
        ydoc,
        awareness: new Awareness(ydoc),
        ready: Promise.resolve(),
        onStorageError: () => () => undefined,
        destroy() {
          bodies.set(id, Y.encodeStateAsUpdate(ydoc));
          ydoc.destroy();
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async listAll() {
      return [...docs.values()];
    },
    async updateMeta(id, update) {
      const current = docs.get(id);
      if (!current) return undefined;
      const next = update(current);
      if (next) docs.set(id, next);
      return next ?? current;
    },
    async insertIfAbsent(doc) {
      if (docs.has(doc.id)) return false;
      docs.set(doc.id, doc);
      return true;
    },
    async purge(id) {
      docs.delete(id);
      bodies.delete(id);
    },
    async wipe() {
      docs.clear();
      bodies.clear();
    },
  };
  return store;
}
