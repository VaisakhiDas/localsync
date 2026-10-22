import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { alice, bob, clientTracker, createControllablePersistence, createStaticAuthorizer, DOC_ID, startTestServer, type TestServer } from '../test/harness';
import { createMemoryPersistence } from './memoryPersistence';

const wait = { timeout: 8000, interval: 10 };

describe('"Synced" means durably stored on the server', () => {
  let server: TestServer;
  const clients = clientTracker();
  afterEach(async () => {
    clients.closeAll();
    await server?.close();
  });

  it('stays "syncing" while the server has not stored the change, even though collaborators already see it', async () => {
    const { persistence, control } = createControllablePersistence();
    server = await startTestServer({ persistence, authorizer: createStaticAuthorizer([alice, bob]) });
    const a = clients.create(server, DOC_ID);
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);

    let release!: () => void;
    control.gate = new Promise<void>((resolve) => (release = resolve)); // the database is "slow"
    a.text.insert(0, 'not stored yet');
    await vi.waitFor(() => expect(b.text.toString()).toBe('not stored yet'), wait); // live relay works...
    await new Promise((r) => setTimeout(r, 250));
    expect(a.phase()).toBe('syncing'); // ...but A must NOT claim it is safe on the server.

    release();
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
  });

  it('never claims "synced" while storage is failing, and recovers once it works again', async () => {
    const { persistence, control, inner } = createControllablePersistence();
    server = await startTestServer({ persistence });
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

    control.failing = true;
    a.text.insert(0, 'storage is down');
    await new Promise((r) => setTimeout(r, 400));
    expect(a.phase()).toBe('syncing');
    expect(inner.snapshot(DOC_ID)).toBeUndefined();

    control.failing = false; // the server retries by itself
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, inner.snapshot(DOC_ID)!);
    expect(stored.getText('t').toString()).toBe('storage is down');
  });

  it('a STALE acknowledgement cannot vouch for a delete-only edit (deletions do not move the state vector)', async () => {
    const { persistence, control } = createControllablePersistence();
    server = await startTestServer({ persistence });
    const a = clients.create(server, DOC_ID);
    a.text.insert(0, 'some text to delete');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

    let release!: () => void;
    control.gate = new Promise<void>((resolve) => (release = resolve)); // storage hangs from now on
    a.text.delete(0, 10);
    // Reconnecting makes the server answer the handshake with its LAST DURABLE acknowledgement,
    // which predates the deletion. Its state vector still covers us (the delete added no
    // operations), so only a delete-set comparison can see that the deletion is not stored yet.
    a.controller.disconnect();
    a.controller.connect();
    await vi.waitFor(() => expect(a.controller.getSnapshot().connected).toBe(true), wait);
    await new Promise((r) => setTimeout(r, 300));
    expect(a.phase()).toBe('syncing');

    release();
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
  });

  it('a client re-syncs its work to a server that lost its data, and does not say "synced" before it is stored', async () => {
    server = await startTestServer({ persistence: createMemoryPersistence() });
    const port = String(server.port);
    const a = clients.create(server, DOC_ID);
    a.text.insert(0, 'precious offline work');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

    await server.close(); // the server dies...
    await vi.waitFor(() => expect(a.phase()).toBe('offline'), wait);

    // ...and returns on the same address with an EMPTY database (a restored backup, a new environment).
    // The client's previous acknowledgement is stale and must not be trusted for the new connection.
    const freshPersistence = createMemoryPersistence();
    const claimedSyncedWhileServerEmpty: boolean[] = [];
    const stop = a.controller.subscribe(() => {
      if (a.phase() === 'synced') claimedSyncedWhileServerEmpty.push(freshPersistence.snapshot(DOC_ID) === undefined);
    });
    server = await startTestServer({ persistence: freshPersistence, env: { PORT: port } });
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    stop();

    expect(claimedSyncedWhileServerEmpty).not.toContain(true); // every "synced" came AFTER the data was stored
    const check = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(check.text.toString()).toBe('precious offline work'), wait);
  });

  it('graceful shutdown flushes pending changes and closes sockets with 1001 (going away)', async () => {
    const persistence = createMemoryPersistence();
    server = await startTestServer({ persistence, env: { PERSIST_DEBOUNCE_MS: '60000', PERSIST_MAX_WAIT_MS: '60000' } });
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.controller.getSnapshot().connected).toBe(true), wait);
    a.text.insert(0, 'unsaved at shutdown');
    await vi.waitFor(() => expect(server.realtime.stats().connections).toBe(1), wait);
    await new Promise((r) => setTimeout(r, 100)); // let the update reach the server
    expect(persistence.snapshot(DOC_ID)).toBeUndefined(); // debounce has not fired: nothing stored yet

    await server.close();

    const stored = new Y.Doc();
    Y.applyUpdate(stored, persistence.snapshot(DOC_ID)!);
    expect(stored.getText('t').toString()).toBe('unsaved at shutdown');
    await vi.waitFor(() => expect(a.controller.getSnapshot().connected).toBe(false), wait);
  });
});
