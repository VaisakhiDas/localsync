import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { routeUnhandledRejectionsToWindow } from '../test/unhandledRejections';
import { CONTENT_FIELD, DocumentStoreError } from './documentStore';
import { createIndexedDbDocumentStore } from './idbDocumentStore';

const typeInto = (ydoc: Y.Doc, text: string) => {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [p]);
};
const textOf = (ydoc: Y.Doc) => ydoc.getXmlFragment(CONTENT_FIELD).toString();

describe('IndexedDB document store: persistence across reloads', () => {
  it('keeps documents and their metadata when the store is recreated (page reload)', async () => {
    const before = createIndexedDbDocumentStore({ namespace: 'u1' });
    const doc = await before.create();
    await before.rename(doc.id, 'Quarterly plan');

    const after = createIndexedDbDocumentStore({ namespace: 'u1' }); // new instance, same IndexedDB
    const listed = await after.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: doc.id, title: 'Quarterly plan', role: 'owner' });
  });

  it('restores document content into a fresh Y.Doc after close and reopen', async () => {
    const store = createIndexedDbDocumentStore({ namespace: 'u1' });
    const { id } = await store.create();

    const first = store.openContent(id);
    await first.ready;
    typeInto(first.ydoc, 'Written before the reload');
    first.destroy();

    const second = createIndexedDbDocumentStore({ namespace: 'u1' }).openContent(id);
    await second.ready;
    expect(textOf(second.ydoc)).toContain('Written before the reload');
    second.destroy();
  });

  it('applies edits made across several sessions, in order, without loss', async () => {
    const store = createIndexedDbDocumentStore({ namespace: 'u1' });
    const { id } = await store.create();
    for (const word of ['one', 'two', 'three']) {
      const session = store.openContent(id);
      await session.ready;
      typeInto(session.ydoc, word);
      session.destroy();
    }
    const final = store.openContent(id);
    await final.ready;
    const text = textOf(final.ydoc);
    expect(['one', 'two', 'three'].every((w) => text.includes(w))).toBe(true);
    final.destroy();
  });

  it('isolates two documents and two namespaces from each other', async () => {
    const a = createIndexedDbDocumentStore({ namespace: 'alice' });
    const b = createIndexedDbDocumentStore({ namespace: 'bob' });
    const docA = await a.create();
    await b.create();
    expect(await a.list()).toHaveLength(1);
    expect(await b.list()).toHaveLength(1);
    expect((await b.list())[0]!.id).not.toBe(docA.id);

    const sessionA = a.openContent(docA.id);
    await sessionA.ready;
    typeInto(sessionA.ydoc, 'alice only');
    sessionA.destroy();

    // Bob opening the same id in his own namespace sees an empty document.
    const asBob = b.openContent(docA.id);
    await asBob.ready;
    expect(textOf(asBob.ydoc)).toBe('');
    asBob.destroy();
  });

  it('deletes the stored body together with the metadata', async () => {
    const store = createIndexedDbDocumentStore({ namespace: 'u1' });
    const { id } = await store.create();
    const session = store.openContent(id);
    await session.ready;
    typeInto(session.ydoc, 'to be deleted');
    session.destroy();
    await new Promise((r) => setTimeout(r, 20));

    await store.remove(id);
    await vi.waitFor(async () => {
      const names = (await indexedDB.databases()).map((d) => d.name);
      expect(names).not.toContain(`localsync:u1:doc:${id}`);
    });
  });

  it('notifies other tabs (store instances) about changes', async () => {
    const tabA = createIndexedDbDocumentStore({ namespace: 'shared' });
    const tabB = createIndexedDbDocumentStore({ namespace: 'shared' });
    const heard = vi.fn();
    const unsubscribe = tabB.subscribe(heard);
    await tabA.create();
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
    unsubscribe();
  });
});

describe('IndexedDB document store: storage failures are visible', () => {
  const brokenIndexedDb = () =>
    ({
      open() {
        const request = Object.assign(new EventTarget(), {
          error: new DOMException('Access to storage is denied.', 'SecurityError'),
          onerror: null as null | ((event: never) => void),
        });
        setTimeout(() => {
          request.onerror?.({ target: request } as never);
          request.dispatchEvent(new Event('error'));
        }, 0);
        return request;
      },
    }) as unknown as IDBFactory;

  it('turns an unusable IndexedDB into a readable error instead of hanging', async () => {
    vi.stubGlobal('indexedDB', brokenIndexedDb());
    const store = createIndexedDbDocumentStore({ namespace: 'broken' });
    await expect(store.list()).rejects.toBeInstanceOf(DocumentStoreError);
    await expect(store.create()).rejects.toThrow(/storage is unavailable/i);
  });

  it('rejects a document body that cannot be opened rather than showing an empty editor', async () => {
    const restore = routeUnhandledRejectionsToWindow(); // y-indexeddb leaves a promise unhandled on open failure
    try {
      vi.stubGlobal('indexedDB', brokenIndexedDb());
      const session = createIndexedDbDocumentStore({ namespace: 'broken' }).openContent('00000000-0000-4000-8000-000000000001');
      const reported = vi.fn();
      session.onStorageError(reported);
      await expect(session.ready).rejects.toThrow(/storage is unavailable/i);
      await new Promise((r) => setTimeout(r, 20)); // let Node emit the unhandled rejection
      // The production window listener claimed it and surfaced it as a storage error.
      expect(reported).toHaveBeenCalledWith(expect.any(DocumentStoreError));
      session.destroy();
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      restore();
    }
  });

  it('recovers on retry once storage works again (the failure is not cached)', async () => {
    const working = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', brokenIndexedDb());
    const store = createIndexedDbDocumentStore({ namespace: 'flaky' });
    await expect(store.list()).rejects.toBeInstanceOf(DocumentStoreError);
    vi.stubGlobal('indexedDB', working);
    await expect(store.list()).resolves.toEqual([]);
  });
});
