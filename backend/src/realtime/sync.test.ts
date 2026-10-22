import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { alice, bob, clientTracker, createProxy, createStaticAuthorizer, DOC_ID, startTestServer, type TestServer } from '../test/harness';

const wait = { timeout: 8000, interval: 10 };

describe('synchronisation: replicas converge through the real server', () => {
  let server: TestServer;
  const clients = clientTracker();

  beforeEach(async () => {
    server = await startTestServer({ authorizer: createStaticAuthorizer([alice, bob]) });
  });
  afterEach(async () => {
    clients.closeAll();
    await server.close();
  });

  it('delivers an edit from one client to another', async () => {
    const a = clients.create(server, DOC_ID);
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);

    a.text.insert(0, 'hello from A');
    await vi.waitFor(() => expect(b.text.toString()).toBe('hello from A'), wait);
  });

  it('merges concurrent edits made on both sides at the same time', async () => {
    const a = clients.create(server, DOC_ID);
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);

    // Same instant, same position, no coordination.
    Y.transact(a.ydoc, () => a.text.insert(0, 'AAA'));
    Y.transact(b.ydoc, () => b.text.insert(0, 'BBB'));

    await vi.waitFor(() => {
      expect(a.text.toString()).toBe(b.text.toString());
      expect(a.text.length).toBe(6);
    }, wait);
    expect(a.text.toString()).toMatch(/AAA/);
    expect(a.text.toString()).toMatch(/BBB/);
  });

  it('gives a late joiner the full existing document', async () => {
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.text.insert(0, 'written before B arrived');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(b.text.toString()).toBe('written before B arrived'), wait);
  });

  it('keeps documents separate from each other', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const a = clients.create(server, DOC_ID);
    const b = clients.create(server, other);
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);
    a.text.insert(0, 'only in doc one');
    await vi.waitFor(() => expect(server.persistence).toBeDefined());
    await new Promise((r) => setTimeout(r, 150));
    expect(b.text.toString()).toBe('');
  });

  it('persists state and restores it after every client has left and the room was evicted', async () => {
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.text.insert(0, 'durable text');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.close();

    // ROOM_IDLE_MS is 60 ms in tests: wait until the room is gone from memory.
    await vi.waitFor(() => expect(server.realtime.stats().rooms).toBe(0), wait);

    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(b.text.toString()).toBe('durable text'), wait);
  });

  it('survives a server restart: the document comes back from persistence', async () => {
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.text.insert(0, 'before restart');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.close();
    const persistence = server.persistence;
    await server.close();

    server = await startTestServer({ persistence, authorizer: createStaticAuthorizer([alice, bob]) });
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(b.text.toString()).toBe('before restart'), wait);
  });
});

describe('offline-first: disconnect, edit, reconnect', () => {
  let server: TestServer;
  const clients = clientTracker();

  beforeEach(async () => {
    server = await startTestServer({ authorizer: createStaticAuthorizer([alice, bob]) });
  });
  afterEach(async () => {
    clients.closeAll();
    await server.close();
  });

  it('edits made while disconnected are delivered after reconnecting, and both sides converge', async () => {
    const a = clients.create(server, DOC_ID);
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);
    a.text.insert(0, 'shared start. ');
    await vi.waitFor(() => expect(b.text.toString()).toBe('shared start. '), wait);

    a.controller.disconnect(); // A goes offline
    await vi.waitFor(() => expect(a.phase()).toBe('offline'), wait);

    a.text.insert(a.text.length, 'A edits offline. ');
    b.text.insert(b.text.length, 'B edits meanwhile. ');
    await vi.waitFor(() => expect(b.phase()).toBe('synced'), wait);
    // While A is offline it must NOT claim to be synced, and must not have lost its own edit.
    expect(a.phase()).toBe('offline');
    expect(a.text.toString()).toContain('A edits offline.');
    expect(a.text.toString()).not.toContain('B edits meanwhile.');

    a.controller.connect(); // A comes back
    await vi.waitFor(() => {
      expect(a.text.toString()).toBe(b.text.toString());
      expect(a.text.toString()).toContain('A edits offline.');
      expect(a.text.toString()).toContain('B edits meanwhile.');
      expect(a.phase()).toBe('synced');
    }, wait);
  });

  it('handles many offline/online cycles with edits on both sides each time', async () => {
    const a = clients.create(server, DOC_ID);
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect([a.phase(), b.phase()]).toEqual(['synced', 'synced']), wait);

    for (let round = 0; round < 5; round++) {
      a.controller.disconnect();
      a.text.insert(a.text.length, `[a${round}]`);
      b.text.insert(b.text.length, `[b${round}]`);
      a.text.insert(0, `<a${round}>`);
      a.controller.connect();
      await vi.waitFor(() => {
        expect(a.text.toString()).toBe(b.text.toString());
        expect(a.phase()).toBe('synced');
      }, wait);
    }
    for (let round = 0; round < 5; round++) {
      expect(a.text.toString()).toContain(`[a${round}]`);
      expect(a.text.toString()).toContain(`[b${round}]`);
      expect(a.text.toString()).toContain(`<a${round}>`);
    }
  });

  it('delivers a burst of offline edits exactly once (no duplication after reconnect)', async () => {
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.controller.disconnect();
    for (let i = 0; i < 50; i++) a.text.insert(a.text.length, `${i},`);
    const expected = a.text.toString();

    a.controller.connect();
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    a.controller.disconnect();
    a.controller.connect(); // re-sends the whole handshake: must be idempotent
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

    const fresh = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(fresh.text.toString()).toBe(expected), wait);
  });

  it('reconnects by itself after the network drops abruptly (no close frame)', async () => {
    const proxy = await createProxy(server.port);
    try {
      const a = clients.create(proxy, DOC_ID);
      await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);

      proxy.sever(); // the cable is pulled
      a.text.insert(0, 'typed during the outage');
      await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait); // reconnected, re-synced, acknowledged

      const b = clients.create(server, DOC_ID, { user: bob });
      await vi.waitFor(() => expect(b.text.toString()).toBe('typed during the outage'), wait);
    } finally {
      await proxy.close();
    }
  });

  it('reconnects after the server asks it to (permissions changed, transient close code)', async () => {
    const a = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    server.realtime.disconnectUser(DOC_ID, 'alice');
    a.text.insert(0, 'after kick');
    await vi.waitFor(() => expect(a.phase()).toBe('synced'), wait);
    const b = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(b.text.toString()).toBe('after kick'), wait);
  });
});
