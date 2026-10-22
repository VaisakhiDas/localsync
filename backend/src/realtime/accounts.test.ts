import { CloseCode } from '@localsync/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Db } from '../db/pool';
import { newDocumentId, signUp, startApiServer, type ApiServer } from '../test/api';
import { createTestDatabase } from '../test/db';
import { clientTracker } from '../test/harness';

const wait = { timeout: 8000, interval: 10 };

/** The WebSocket door obeys the same rules as the HTTP door, with identity from the session cookie. */
describe('realtime access control with accounts (PostgreSQL)', () => {
  let server: ApiServer;
  let db: Db;
  let drop: () => Promise<void>;
  const clients = clientTracker();

  type Person = Awaited<ReturnType<typeof signUp>>;
  let alice: Person, bob: Person, vera: Person, sam: Person;

  const sharedDoc = async () => {
    const id = newDocumentId();
    await alice.api.put(`/api/documents/${id}`, { title: 'Live doc' });
    await alice.api.post(`/api/documents/${id}/members`, { email: bob.user.email, role: 'editor' });
    await alice.api.post(`/api/documents/${id}/members`, { email: vera.user.email, role: 'viewer' });
    return id;
  };
  const connect = (id: string, p: Person | null, cookie = p?.api.cookie ?? '') => clients.create(server, id, { cookie, user: null });

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase());
    server = await startApiServer(db);
    [alice, bob, vera, sam] = await Promise.all(['Alice', 'Bob', 'Vera', 'Sam'].map((n) => signUp(server, n))) as [Person, Person, Person, Person];
  });
  afterEach(() => clients.closeAll());
  afterAll(async () => {
    await server.close();
    await drop();
  });

  it('owner and editor collaborate; the merged document is persisted to PostgreSQL', async () => {
    const id = await sharedDoc();
    const a = connect(id, alice);
    const b = connect(id, bob);
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);

    a.text.insert(0, 'Alice was here. ');
    b.text.insert(0, 'Bob too. ');
    await vi.waitFor(() => {
      expect(a.text.toString()).toBe(b.text.toString());
      expect(a.phase()).toBe('synced'); // "synced" is only claimed after the row below exists
    }, wait);

    const { rows } = await db.query<{ state: Buffer }>('SELECT state FROM document_states WHERE document_id = $1', [id]);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(rows[0]!.state));
    expect(stored.getText('t').toString()).toBe(a.text.toString());
  });

  it('a signed-in stranger is refused (4403) and never receives the content', async () => {
    const id = await sharedDoc();
    const a = connect(id, alice);
    a.text.insert(0, 'private text');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

    const intruder = connect(id, sam);
    await vi.waitFor(() => expect(intruder.phase()).toBe('denied'), wait);
    expect(intruder.controller.getSnapshot().denied?.code).toBe(CloseCode.Forbidden);
    expect(intruder.text.toString()).toBe('');
  });

  it('refuses a missing, forged or expired session (4401)', async () => {
    const id = await sharedDoc();
    const missing = connect(id, null, '');
    const forged = connect(id, null, 'ls_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await vi.waitFor(() => expect([missing.phase(), forged.phase()]).toEqual(['denied', 'denied']), wait);
    expect(missing.controller.getSnapshot().denied?.code).toBe(CloseCode.Unauthenticated);
    expect(forged.controller.getSnapshot().denied?.code).toBe(CloseCode.Unauthenticated);

    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [sam.user.id]);
    const expired = connect(id, sam);
    await vi.waitFor(() => expect(expired.phase()).toBe('denied'), wait);
    expect(expired.controller.getSnapshot().denied?.code).toBe(CloseCode.Unauthenticated);
    await db.query("UPDATE sessions SET expires_at = now() + interval '1 day' WHERE user_id = $1", [sam.user.id]);
  });

  it('refuses documents that were never registered, even for an authenticated user', async () => {
    const unregistered = connect(newDocumentId(), alice);
    await vi.waitFor(() => expect(unregistered.phase()).toBe('denied'), wait);
    expect(unregistered.controller.getSnapshot().denied?.code).toBe(CloseCode.Forbidden);
  });

  it('a viewer reads live but cannot write: the role comes from the database', async () => {
    const id = await sharedDoc();
    const a = connect(id, alice);
    const v = connect(id, vera);
    await vi.waitFor(() => expect([a.phase(), v.phase()]).toEqual(['synced', 'synced']), wait);
    expect(v.controller.getSnapshot().readOnly).toBe(true);

    a.text.insert(0, 'from the owner');
    await vi.waitFor(() => expect(v.text.toString()).toBe('from the owner'), wait);
    v.text.insert(0, 'VIEWER WRITE ');
    await new Promise((r) => setTimeout(r, 300));
    expect(a.text.toString()).toBe('from the owner');
    const { rows } = await db.query<{ state: Buffer }>('SELECT state FROM document_states WHERE document_id = $1', [id]);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(rows[0]!.state));
    expect(stored.getText('t').toString()).toBe('from the owner');
  });

  it('demoting an editor to viewer takes effect on their OPEN connection', async () => {
    const id = await sharedDoc();
    const b = connect(id, bob);
    await vi.waitFor(() => expect(b.phase()).toBe('synced'), wait);
    expect(b.controller.getSnapshot().readOnly).toBe(false);

    expect((await alice.api.patch(`/api/documents/${id}/members/${bob.user.id}`, { role: 'viewer' })).status).toBe(200);
    await vi.waitFor(() => expect(b.controller.getSnapshot().readOnly).toBe(true), wait); // kicked, reconnected, re-authorised
    b.text.insert(0, 'should be ignored');
    await new Promise((r) => setTimeout(r, 300));
    const probe = connect(id, alice);
    await vi.waitFor(() => expect(probe.phase()).toBe('synced'), wait);
    expect(probe.text.toString()).not.toContain('ignored');
  });

  it('removing a member disconnects them and locks them out', async () => {
    const id = await sharedDoc();
    const b = connect(id, bob);
    await vi.waitFor(() => expect(b.phase()).toBe('synced'), wait);
    await alice.api.delete(`/api/documents/${id}/members/${bob.user.id}`);
    await vi.waitFor(() => expect(b.phase()).toBe('denied'), wait);
    expect(b.controller.getSnapshot().denied?.code).toBe(CloseCode.Forbidden);
  });

  it('logging out drops that session\'s sockets', async () => {
    const id = await sharedDoc();
    const v = connect(id, vera);
    await vi.waitFor(() => expect(v.phase()).toBe('synced'), wait);
    await vera.api.post('/api/auth/logout');
    await vi.waitFor(() => expect(v.phase()).toBe('denied'), wait);
    expect(v.controller.getSnapshot().denied?.code).toBe(CloseCode.Unauthenticated);
    // sign vera back in for the remaining tests
    const again = await vera.api.post('/api/auth/login', { email: vera.user.email, password: 'correct horse battery staple' });
    expect(again.status).toBe(200);
  });

  it('deleting a document closes it for everyone connected, permanently', async () => {
    const id = await sharedDoc();
    const a = connect(id, alice);
    const b = connect(id, bob);
    a.text.insert(0, 'about to vanish');
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);

    expect((await alice.api.delete(`/api/documents/${id}`)).status).toBe(204);
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['denied', 'denied']), wait);
    expect((await db.query('SELECT 1 FROM document_states WHERE document_id = $1', [id])).rowCount).toBe(0);
    // And it stays gone: no stray flush resurrects a row.
    await new Promise((r) => setTimeout(r, 400));
    expect((await db.query('SELECT 1 FROM document_states WHERE document_id = $1', [id])).rowCount).toBe(0);
  });

  it('survives a server restart: content is restored from PostgreSQL for a new connection', async () => {
    const id = await sharedDoc();
    const a = connect(id, alice);
    a.text.insert(0, 'stored in postgres');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.close();
    await server.close();
    server = await startApiServer(db);

    // Sessions live in the database, so the same cookies keep working on the new process.
    const b = connect(id, bob);
    await vi.waitFor(() => expect(b.text.toString()).toBe('stored in postgres'), wait);
  });
});
