import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Db } from '../db/pool';
import { ApiClient, newDocumentId, signUp, startApiServer, type ApiServer } from '../test/api';
import { createTestDatabase } from '../test/db';
import { clientTracker } from '../test/harness';

const wait = { timeout: 8000, interval: 10 };

describe('version history', () => {
  let server: ApiServer;
  let db: Db;
  let drop: () => Promise<void>;
  let alice: ApiClient, bob: ApiClient, vera: ApiClient, sam: ApiClient;
  const clients = clientTracker();

  const sharedDoc = async () => {
    const id = newDocumentId();
    await alice.put(`/api/documents/${id}`, { title: 'History' });
    await alice.post(`/api/documents/${id}/members`, { email: 'bob@example.com', role: 'editor' });
    await alice.post(`/api/documents/${id}/members`, { email: 'vera@example.com', role: 'viewer' });
    return id;
  };
  const stateOf = async (api: ApiClient, docId: string, versionId: string) => {
    const res = await fetch(`${server.httpUrl}/api/documents/${docId}/versions/${versionId}/state`, { headers: { cookie: api.cookie, origin: 'http://localhost:5173' } });
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') };
  };
  const textIn = (bytes: Uint8Array) => {
    const d = new Y.Doc();
    Y.applyUpdate(d, bytes);
    return d.getText('t').toString();
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase());
    server = await startApiServer(db, { AUTO_VERSION_INTERVAL_MS: '0', AUTO_VERSIONS_KEPT: '3' });
    alice = (await signUp(server, 'Alice')).api;
    bob = (await signUp(server, 'Bob')).api;
    vera = (await signUp(server, 'Vera')).api;
    sam = (await signUp(server, 'Sam')).api;
  });
  afterAll(async () => {
    clients.closeAll();
    await server.close();
    await drop();
  });

  it('saving a version freezes the SERVER\'s merged state and records who saved it', async () => {
    const id = await sharedDoc();
    const a = clients.create(server, id, { cookie: alice.cookie, user: null });
    const b = clients.create(server, id, { cookie: bob.cookie, user: null });
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);
    a.text.insert(0, 'first draft. ');
    b.text.insert(0, 'bob adds. ');
    await vi.waitFor(() => {
      expect(a.text.toString()).toBe(b.text.toString());
      expect(a.phase()).toBe('synced');
    }, wait);

    const saved = await alice.post(`/api/documents/${id}/versions`, { label: '  Draft one  ' });
    expect(saved.status).toBe(201);
    expect(saved.body.version).toMatchObject({ label: 'Draft one', createdByName: 'Alice' });
    expect(saved.body.version.sizeBytes).toBeGreaterThan(0);

    a.text.insert(a.text.length, 'LATER EDIT'); // after the snapshot: must not appear in it
    const { status, bytes, type } = await stateOf(alice, id, saved.body.version.id);
    expect(status).toBe(200);
    expect(type).toMatch(/octet-stream/);
    expect(textIn(bytes)).toBe(a.text.toString().replace('LATER EDIT', '')); // both collaborators' work, nothing newer
    expect(textIn(bytes)).toContain('first draft.');
    expect(textIn(bytes)).toContain('bob adds.');
  });

  it('versions are frozen: later edits never change an existing version', async () => {
    const id = await sharedDoc();
    const a = clients.create(server, id, { cookie: alice.cookie, user: null });
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.text.insert(0, 'v1');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    const v1 = (await alice.post(`/api/documents/${id}/versions`, {})).body.version;
    a.text.insert(2, ' and more');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    expect(textIn((await stateOf(alice, id, v1.id)).bytes)).toBe('v1');
  });

  it('automatic checkpoints appear when a document is saved, have no author, and the history stays bounded', async () => {
    const id = await sharedDoc();
    const a = clients.create(server, id, { cookie: alice.cookie, user: null });
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    for (let i = 0; i < 8; i++) {
      a.text.insert(a.text.length, `edit${i} `);
      await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    }
    const versions = (await alice.get(`/api/documents/${id}/versions`)).body.versions;
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.length).toBeLessThanOrEqual(3); // AUTO_VERSIONS_KEPT
    expect(versions.every((v: { createdById: string | null }) => v.createdById === null)).toBe(true);
    // Saved versions are never pruned by the automatic checkpoints.
    const manual = (await alice.post(`/api/documents/${id}/versions`, { label: 'keep me' })).body.version;
    a.text.insert(a.text.length, 'more ');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    expect((await alice.get(`/api/documents/${id}/versions`)).body.versions.map((v: { id: string }) => v.id)).toContain(manual.id);
  });

  it('authorisation: members read history, only contributors save, strangers learn nothing', async () => {
    const id = await sharedDoc();
    const a = clients.create(server, id, { cookie: alice.cookie, user: null });
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.text.insert(0, 'secret');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    const v = (await alice.post(`/api/documents/${id}/versions`, {})).body.version;

    expect((await bob.post(`/api/documents/${id}/versions`, { label: 'by editor' })).status).toBe(201);
    expect((await vera.post(`/api/documents/${id}/versions`, {})).status).toBe(403); // viewers cannot save
    expect((await vera.get(`/api/documents/${id}/versions`)).status).toBe(200); // but can read history
    expect((await stateOf(vera, id, v.id)).status).toBe(200);

    expect((await sam.get(`/api/documents/${id}/versions`)).status).toBe(404);
    expect((await sam.post(`/api/documents/${id}/versions`, {})).status).toBe(404);
    expect((await stateOf(sam, id, v.id)).status).toBe(404);
    expect((await new ApiClient(server.httpUrl).get(`/api/documents/${id}/versions`)).status).toBe(401);
  });

  it('a version id from ANOTHER document is "not found", even for a member of both', async () => {
    const one = await sharedDoc();
    const two = await sharedDoc();
    const a = clients.create(server, one, { cookie: alice.cookie, user: null });
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.text.insert(0, 'x');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    const v = (await alice.post(`/api/documents/${one}/versions`, {})).body.version;
    expect((await stateOf(alice, two, v.id)).status).toBe(404);
    expect((await stateOf(alice, one, 'not-a-uuid')).status).toBe(404);
  });

  it('validates labels and removes history when the document is deleted', async () => {
    const id = await sharedDoc();
    expect((await alice.post(`/api/documents/${id}/versions`, { label: 'x'.repeat(121) })).status).toBe(400);
    await alice.post(`/api/documents/${id}/versions`, { label: 'ok' });
    await alice.delete(`/api/documents/${id}`);
    expect((await db.query('SELECT 1 FROM document_versions WHERE document_id = $1', [id])).rowCount).toBe(0);
  });
});

describe('comments', () => {
  let server: ApiServer;
  let db: Db;
  let drop: () => Promise<void>;
  let alice: ApiClient, bob: ApiClient, vera: ApiClient, sam: ApiClient;
  let docId: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase());
    server = await startApiServer(db);
    alice = (await signUp(server, 'Alice')).api;
    bob = (await signUp(server, 'Bob')).api;
    vera = (await signUp(server, 'Vera')).api;
    sam = (await signUp(server, 'Sam')).api;
    docId = newDocumentId();
    await alice.put(`/api/documents/${docId}`, { title: 'Reviewed' });
    await alice.post(`/api/documents/${docId}/members`, { email: 'bob@example.com', role: 'editor' });
    await alice.post(`/api/documents/${docId}/members`, { email: 'vera@example.com', role: 'viewer' });
  });
  afterAll(async () => {
    await server.close();
    await drop();
  });

  it('owners and editors comment; the quote is stored as a copy; everyone with access can read', async () => {
    const posted = await bob.post(`/api/documents/${docId}/comments`, { body: '  Please reword this.  ', quote: 'the selected sentence' });
    expect(posted.status).toBe(201);
    expect(posted.body.comment).toMatchObject({ body: 'Please reword this.', quote: 'the selected sentence', authorName: 'Bob', resolved: false });
    for (const reader of [alice, bob, vera]) {
      expect((await reader.get(`/api/documents/${docId}/comments`)).body.comments.map((c: { body: string }) => c.body)).toContain('Please reword this.');
    }
  });

  it('viewers cannot write or resolve; strangers see nothing; anonymous is refused', async () => {
    const { body } = await alice.post(`/api/documents/${docId}/comments`, { body: 'Owner note' });
    const id = body.comment.id;
    expect((await vera.post(`/api/documents/${docId}/comments`, { body: 'viewer note' })).status).toBe(403);
    expect((await vera.patch(`/api/documents/${docId}/comments/${id}`, { resolved: true })).status).toBe(403);
    expect((await sam.get(`/api/documents/${docId}/comments`)).status).toBe(404);
    expect((await sam.post(`/api/documents/${docId}/comments`, { body: 'hi' })).status).toBe(404);
    expect((await new ApiClient(server.httpUrl).get(`/api/documents/${docId}/comments`)).status).toBe(401);
  });

  it('contributors can resolve and reopen a thread', async () => {
    const id = (await alice.post(`/api/documents/${docId}/comments`, { body: 'To resolve' })).body.comment.id;
    expect((await bob.patch(`/api/documents/${docId}/comments/${id}`, { resolved: true })).body.comment.resolved).toBe(true);
    expect((await alice.patch(`/api/documents/${docId}/comments/${id}`, { resolved: false })).body.comment.resolved).toBe(false);
    expect((await alice.patch(`/api/documents/${docId}/comments/${id}`, { resolved: 'yes' })).status).toBe(400);
  });

  it('only the author or the owner may delete a comment', async () => {
    const mine = (await bob.post(`/api/documents/${docId}/comments`, { body: "Bob's comment" })).body.comment.id;
    const owners = (await alice.post(`/api/documents/${docId}/comments`, { body: "Alice's comment" })).body.comment.id;
    expect((await bob.delete(`/api/documents/${docId}/comments/${owners}`)).status).toBe(403); // an editor cannot delete the owner's
    expect((await vera.delete(`/api/documents/${docId}/comments/${mine}`)).status).toBe(403);
    expect((await alice.delete(`/api/documents/${docId}/comments/${mine}`)).status).toBe(204); // the owner moderates
    expect((await bob.delete(`/api/documents/${docId}/comments/${owners}`)).status).toBe(403);
    expect((await alice.delete(`/api/documents/${docId}/comments/${owners}`)).status).toBe(204);
  });

  it('validates input and keeps comments with their document', async () => {
    expect((await alice.post(`/api/documents/${docId}/comments`, { body: '   ' })).status).toBe(400);
    expect((await alice.post(`/api/documents/${docId}/comments`, { body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await alice.post(`/api/documents/${docId}/comments`, { body: 'ok', quote: 'q'.repeat(301) })).status).toBe(400);
    const other = newDocumentId();
    await alice.put(`/api/documents/${other}`, { title: 'Other' });
    const id = (await alice.post(`/api/documents/${docId}/comments`, { body: 'belongs to the first' })).body.comment.id;
    expect((await alice.patch(`/api/documents/${other}/comments/${id}`, { resolved: true })).status).toBe(404); // wrong document
    await alice.delete(`/api/documents/${docId}`);
    expect((await db.query('SELECT 1 FROM comments WHERE document_id = $1', [docId])).rowCount).toBe(0);
  });
});
