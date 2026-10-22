import type { DocumentDto } from '@localsync/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './api';
import { createIndexedDbDocumentStore } from './idbDocumentStore';
import { createMemoryDocumentStore } from './memoryDocumentStore';
import { MetadataSync } from './metadataSync';
import type { DocumentStore } from './documentStore';

/** An in-memory stand-in for the server's document API, with switches for failure. */
function fakeServer(initial: DocumentDto[] = []) {
  const docs = new Map(initial.map((d) => [d.id, d]));
  const calls: string[] = [];
  const control = { offline: false, unauthorized: false, gate: null as Promise<void> | null };
  const guard = async () => {
    if (control.offline) throw new NetworkError();
    if (control.unauthorized) throw new ApiError(401, 'unauthenticated', 'Sign in');
    if (control.gate) await control.gate;
  };
  const dto = (id: string, title: string, role: DocumentDto['role'] = 'owner'): DocumentDto => ({
    id, title, role, ownerName: 'Me', createdAt: new Date(1000).toISOString(), updatedAt: new Date(2000).toISOString(),
  });
  const api = {
    async listDocuments() { await guard(); calls.push('list'); return [...docs.values()]; },
    async registerDocument(id: string, title: string) { await guard(); calls.push(`register:${title}`); const d = docs.get(id) ?? dto(id, title); docs.set(id, d); return d; },
    async renameDocument(id: string, title: string) { await guard(); calls.push(`rename:${title}`); const d = { ...docs.get(id)!, title }; docs.set(id, d); return d; },
    async deleteDocument(id: string) { await guard(); calls.push('delete'); docs.delete(id); },
    async removeMember(id: string) { await guard(); calls.push('leave'); docs.delete(id); },
  };
  return { api, docs, calls, control, dto };
}

const make = (store: DocumentStore, server: ReturnType<typeof fakeServer>, extra: Partial<ConstructorParameters<typeof MetadataSync>[0]> = {}) =>
  new MetadataSync({ store, api: server.api, userId: 'me', ...extra });

describe('metadata sync: documents created and edited offline reach the server later', () => {
  it('uploads a document created while offline, once the network returns, without losing it in between', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const doc = await store.create();
    await store.rename(doc.id, 'Written on a train');
    server.control.offline = true;

    const sync = make(store, server);
    await sync.syncNow();
    expect(sync.getSnapshot()).toBe('offline');
    expect((await store.list()).map((d) => d.title)).toEqual(['Written on a train']); // still there, untouched
    expect((await store.get(doc.id))?.registered).toBe(false);

    server.control.offline = false;
    await sync.syncNow();
    expect(sync.getSnapshot()).toBe('idle');
    expect(server.calls).toContain('register:Written on a train');
    expect(await store.get(doc.id)).toMatchObject({ registered: true, titleDirty: false });
  });

  it('a rename typed while the upload is in flight is not overwritten by the upload result', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const doc = await store.create();
    let release!: () => void;
    server.control.gate = new Promise<void>((r) => (release = r)); // the request hangs...

    const sync = make(store, server);
    const pass = sync.syncNow();
    await vi.waitFor(() => expect(sync.getSnapshot()).toBe('syncing'));
    await store.rename(doc.id, 'Renamed during upload'); // ...and the user keeps typing
    release();
    await pass;

    expect(await store.get(doc.id)).toMatchObject({ title: 'Renamed during upload', titleDirty: true, registered: true });
    server.control.gate = null;
    await sync.syncNow(); // the follow-up pass delivers the newer title
    expect(server.docs.get(doc.id)?.title).toBe('Renamed during upload');
    expect((await store.get(doc.id))?.titleDirty).toBe(false);
  });

  it('pushes a rename of an already-uploaded document exactly once', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const doc = await store.create();
    const sync = make(store, server);
    await sync.syncNow();
    await store.rename(doc.id, 'Second title');
    await sync.syncNow();
    await sync.syncNow();
    expect(server.calls.filter((c) => c.startsWith('rename'))).toEqual(['rename:Second title']);
  });
});

describe('metadata sync: deleting', () => {
  it('a never-uploaded document is simply removed, with no network traffic', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const doc = await store.create();
    await store.remove(doc.id);
    await make(store, server).syncNow();
    expect(server.calls.filter((c) => c === 'delete' || c === 'leave')).toEqual([]);
    expect(await store.listAll()).toEqual([]);
  });

  it('an uploaded document is hidden at once, and deleted on the server when online', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const doc = await store.create();
    const sync = make(store, server);
    await sync.syncNow();

    server.control.offline = true;
    await store.remove(doc.id);
    expect(await store.list()).toEqual([]); // gone from every list immediately...
    await sync.syncNow();
    expect((await store.listAll()).map((d) => d.deleted)).toEqual([true]); // ...but remembered until the server knows

    server.control.offline = false;
    await sync.syncNow();
    expect(server.docs.has(doc.id)).toBe(false);
    expect(await store.listAll()).toEqual([]);
  });

  it('"deleting" a document shared with you means leaving it, never deleting the owner\'s copy', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer([{ id: 'shared-1', title: 'Theirs', role: 'editor', ownerName: 'Alice', createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString() }]);
    const sync = make(store, server);
    await sync.syncNow();
    expect((await store.list()).map((d) => d.id)).toEqual(['shared-1']);
    await store.remove('shared-1');
    await sync.syncNow();
    expect(server.calls).toContain('leave');
    expect(server.calls).not.toContain('delete');
  });
});

describe('metadata sync: pulling from the server', () => {
  it('brings in documents shared with you, with the role and owner the SERVER says', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer([{ id: 'doc-1', title: 'From Alice', role: 'viewer', ownerName: 'Alice', createdAt: new Date(1000).toISOString(), updatedAt: new Date(5000).toISOString() }]);
    await make(store, server).syncNow();
    expect(await store.get('doc-1')).toMatchObject({ title: 'From Alice', role: 'viewer', ownerName: 'Alice', registered: true, updatedAt: 5000 });
  });

  it('tells the UI to refresh when a document shared with you arrives (and stays quiet when nothing changed)', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer([{ id: 'doc-1', title: 'From Alice', role: 'editor', ownerName: 'Alice', createdAt: new Date(1000).toISOString(), updatedAt: new Date(5000).toISOString() }]);
    const sync = make(store, server);
    const refreshed = vi.fn();
    sync.onChanged(refreshed);
    await sync.syncNow();
    expect(refreshed).toHaveBeenCalledTimes(1);
    await sync.syncNow(); // nothing new: no pointless re-render
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('applies server renames, but an unsent local rename wins', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const a = await store.create();
    const b = await store.create();
    const sync = make(store, server);
    await sync.syncNow();

    server.docs.set(a.id, { ...server.docs.get(a.id)!, title: 'Renamed by a collaborator' });
    server.docs.set(b.id, { ...server.docs.get(b.id)!, title: 'Server title for B' });
    server.control.offline = true; // b is renamed locally while offline
    await store.rename(b.id, 'My offline title for B');
    server.control.offline = false;
    await sync.syncNow();

    expect((await store.get(a.id))?.title).toBe('Renamed by a collaborator');
    expect(server.docs.get(b.id)?.title).toBe('My offline title for B'); // pushed before pulling
    expect((await store.get(b.id))?.title).toBe('My offline title for B');
  });

  it('KEEPS a document whose access was removed (or that the owner deleted) as a read-only local copy: nothing is discarded silently', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer([{ id: 'doc-x', title: 'Will vanish', role: 'editor', ownerName: 'Alice', createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString() }]);
    const sync = make(store, server);
    await sync.syncNow();
    const body = store.openContent('doc-x'); // the user has local content, possibly never synced
    body.ydoc.getText('t').insert(0, 'my unsynced edits');
    body.destroy();

    server.docs.delete('doc-x'); // the owner removes this user
    const refreshed = vi.fn();
    sync.onChanged(refreshed);
    await sync.syncNow();

    expect(await store.get('doc-x')).toMatchObject({ revoked: true, title: 'Will vanish' }); // still listed, flagged
    const again = store.openContent('doc-x');
    expect(again.ydoc.getText('t').toString()).toBe('my unsynced edits'); // content intact
    again.destroy();
    expect(refreshed).toHaveBeenCalledTimes(1);

    await sync.syncNow(); // later passes leave it alone and stay quiet
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('a revoked copy is restored to normal if the document is shared with the user again', async () => {
    const store = createMemoryDocumentStore();
    const dto = { id: 'doc-y', title: 'Back again', role: 'viewer' as const, ownerName: 'Alice', createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString() };
    const server = fakeServer([dto]);
    const sync = make(store, server);
    await sync.syncNow();
    server.docs.delete('doc-y');
    await sync.syncNow();
    expect((await store.get('doc-y'))?.revoked).toBe(true);
    server.docs.set('doc-y', dto);
    await sync.syncNow();
    expect((await store.get('doc-y'))?.revoked).toBe(false);
  });

  it('removing a revoked copy only deletes it locally: the server is not contacted', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer([{ id: 'doc-z', title: 'Gone', role: 'editor', ownerName: 'Alice', createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString() }]);
    const sync = make(store, server);
    await sync.syncNow();
    server.docs.delete('doc-z');
    await sync.syncNow();
    server.calls.length = 0;
    await store.remove('doc-z');
    await sync.syncNow();
    expect(server.calls.filter((c) => c === 'leave' || c === 'delete')).toEqual([]);
    expect(await store.listAll()).toEqual([]);
  });

  it('never drops a document that has not been uploaded yet just because the server has not heard of it', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    server.control.offline = true;
    const local = await store.create();
    const sync = make(store, server);
    await sync.syncNow();
    server.control.offline = false;
    server.api.registerDocument = async () => { throw new ApiError(403, 'forbidden', 'nope'); }; // even if the upload is refused
    await sync.syncNow();
    expect(await store.get(local.id)).toBeDefined();
  });
});

describe('metadata sync: failure handling', () => {
  it('reports a rejected session so the app can ask the user to sign in again', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    server.control.unauthorized = true;
    const onUnauthorized = vi.fn();
    const sync = make(store, server, { onUnauthorized });
    await sync.syncNow();
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(sync.getSnapshot()).toBe('error');
  });

  it('is safe to interrupt: a pass that fails half-way is simply continued by the next one', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    const [a, b] = [await store.create(), await store.create()];
    let first = true;
    const realRegister = server.api.registerDocument;
    server.api.registerDocument = async (id, title) => {
      if (id === b.id && first) { first = false; throw new NetworkError(); } // connection drops on the second upload
      return realRegister(id, title);
    };
    const sync = make(store, server);
    await sync.syncNow();
    expect((await store.get(a.id))?.registered).toBe(true);
    expect((await store.get(b.id))?.registered).toBe(false);
    await sync.syncNow();
    expect((await store.get(b.id))?.registered).toBe(true);
    expect(server.calls.filter((c) => c.startsWith('register')).length).toBe(2); // a was not re-sent
  });

  it('never runs two passes at once; a request during a pass produces exactly one follow-up', async () => {
    const store = createMemoryDocumentStore();
    const server = fakeServer();
    let release!: () => void;
    server.control.gate = new Promise<void>((r) => (release = r));
    const sync = make(store, server);
    const first = sync.syncNow();
    const second = sync.syncNow();
    const third = sync.syncNow();
    release();
    await Promise.all([first, second, third]);
    expect(server.calls.filter((c) => c === 'list').length).toBe(2); // not 3
  });
});

describe('metadata sync works the same on the real IndexedDB store', () => {
  it('uploads, renames and deletes through tombstones', async () => {
    const store = createIndexedDbDocumentStore({ namespace: 'sync-idb' });
    const server = fakeServer();
    const sync = make(store, server);
    const doc = await store.create();
    await store.rename(doc.id, 'Via IndexedDB');
    await sync.syncNow();
    expect(server.calls).toContain('register:Via IndexedDB');
    expect(await store.get(doc.id)).toMatchObject({ registered: true, titleDirty: false });

    await store.remove(doc.id);
    expect(await store.list()).toEqual([]);
    expect((await store.listAll())[0]).toMatchObject({ deleted: true });
    await sync.syncNow();
    expect(await store.listAll()).toEqual([]);
    expect(server.docs.size).toBe(0);
  });

  it('wipe() removes the metadata and every document body for that user only', async () => {
    const mine = createIndexedDbDocumentStore({ namespace: 'wipe-me' });
    const other = createIndexedDbDocumentStore({ namespace: 'keep-me' });
    const a = await mine.create();
    await other.create();
    const body = mine.openContent(a.id);
    await body.ready;
    body.destroy();
    await new Promise((r) => setTimeout(r, 30));

    await mine.wipe();
    // Check the databases themselves first: merely listing through a new store would re-create an empty one.
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names.filter((n) => n?.startsWith('localsync:wipe-me:'))).toEqual([]);
    expect(names.filter((n) => n?.startsWith('localsync:keep-me:')).length).toBeGreaterThan(0);
    expect(await createIndexedDbDocumentStore({ namespace: 'wipe-me' }).list()).toEqual([]);
    expect(await other.list()).toHaveLength(1);
  });
});
