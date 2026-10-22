import { CloseCode, MessageType } from '@localsync/shared';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Authorizer } from './types';
import {
  alice,
  bob,
  clientTracker,
  createStaticAuthorizer,
  DOC_ID,
  rawConnect,
  startTestServer,
  vera,
  type TestServer,
} from '../test/harness';

const wait = { timeout: 8000, interval: 10 };
const PRIVATE_DOC = '33333333-3333-4333-8333-333333333333';

describe('access control', () => {
  let server: TestServer;
  const clients = clientTracker();

  beforeEach(async () => {
    server = await startTestServer({ authorizer: createStaticAuthorizer([alice, bob, vera], [PRIVATE_DOC]) });
  });
  afterEach(async () => {
    clients.closeAll();
    await server.close();
  });

  it('refuses a connection without credentials: permanent 4401, nothing is sent, and it does not retry', async () => {
    const stranger = clients.create(server, DOC_ID, { user: null });
    await vi.waitFor(() => expect(stranger.phase()).toBe('denied'), wait);
    expect(stranger.controller.getSnapshot().denied?.code).toBe(CloseCode.Unauthenticated);
    expect(stranger.text.toString()).toBe('');
    // "Permanent" means y-websocket must have stopped reconnecting.
    expect(stranger.controller.provider.shouldConnect).toBe(false);
    expect(server.realtime.stats().connections).toBe(0);
  });

  it('refuses a wrong token', async () => {
    const raw = rawConnect(server, DOC_ID, { token: 'not-a-real-token' });
    await raw.opened;
    expect((await raw.closed).code).toBe(CloseCode.Unauthenticated);
  });

  it('knowing a document id is not enough: a valid user without access gets 4403 and never sees content', async () => {
    // Content exists in the private document...
    await server.persistence.store(PRIVATE_DOC, (() => {
      const d = new Y.Doc();
      d.getText('t').insert(0, 'top secret');
      return Y.encodeStateAsUpdate(d);
    })());
    // ...and bob guesses its id.
    const intruder = clients.create(server, PRIVATE_DOC, { user: bob });
    await vi.waitFor(() => expect(intruder.phase()).toBe('denied'), wait);
    expect(intruder.controller.getSnapshot().denied?.code).toBe(CloseCode.Forbidden);
    expect(intruder.text.toString()).toBe('');
  });

  it.each(['not-a-uuid', '..%2F..%2Fetc%2Fpasswd', '11111111-1111-4111-8111-11111111111g'])(
    'answers a malformed document id (%s) exactly like "no access"',
    async (id) => {
      const raw = rawConnect(server, id, { token: alice.token });
      await raw.opened;
      expect((await raw.closed).code).toBe(CloseCode.Forbidden);
    },
  );

  it('rejects the upgrade itself when the Origin is not allowed (cross-site WebSocket hijacking)', async () => {
    const raw = rawConnect(server, DOC_ID, { token: alice.token, origin: 'http://evil.example' });
    raw.ws.on('error', () => undefined);
    expect(await raw.rejected).toBe(403);
  });

  it('rejects the upgrade when there is no Origin header (browsers always send one)', async () => {
    const raw = rawConnect(server, DOC_ID, { token: alice.token, origin: null });
    raw.ws.on('error', () => undefined);
    expect(await raw.rejected).toBe(403);
  });

  it('answers 404 for WebSocket paths that are not /collab/<id>', async () => {
    const raw = rawConnect(server, DOC_ID, { token: alice.token, path: '/somewhere/else' });
    raw.ws.on('error', () => undefined);
    expect(await raw.rejected).toBe(404);
  });

  it('takes the role from the server, so a re-authorisation after a permission change is honoured', async () => {
    let role: 'editor' | 'viewer' | null = 'editor';
    const authorizer: Authorizer = {
      async authorize() {
        if (!role) return { ok: false, code: 4403, reason: 'Access denied' };
        return { ok: true, access: { userId: 'carol', displayName: 'Carol', role } };
      },
    };
    const dynamic = await startTestServer({ authorizer });
    try {
      const carol = clients.create(dynamic, DOC_ID, { user: null });
      await vi.waitFor(() => expect(carol.phase()).toBe('synced'), wait);
      expect(carol.controller.getSnapshot().readOnly).toBe(false);

      role = 'viewer'; // owner demotes carol
      dynamic.realtime.disconnectUser(DOC_ID, 'carol');
      await vi.waitFor(() => expect(carol.controller.getSnapshot().readOnly).toBe(true), wait);

      role = null; // owner removes carol entirely
      dynamic.realtime.disconnectUser(DOC_ID, 'carol');
      await vi.waitFor(() => expect(carol.phase()).toBe('denied'), wait);
      expect(carol.controller.getSnapshot().denied?.code).toBe(CloseCode.Forbidden);
    } finally {
      clients.closeAll();
      await dynamic.close();
    }
  });

  it('still syncs when the client speaks before authorisation finishes (messages are buffered, not dropped)', async () => {
    const slow = await startTestServer({
      authorizer: {
        async authorize(req, id) {
          await new Promise((r) => setTimeout(r, 150));
          return createStaticAuthorizer([alice]).authorize(req, id);
        },
      },
    });
    try {
      const writer = clients.create(slow, DOC_ID);
      writer.text.insert(0, 'sent immediately');
      await vi.waitFor(() => expect(writer.phase()).toBe('synced'), wait);
      const reader = clients.create(slow, DOC_ID);
      await vi.waitFor(() => expect(reader.text.toString()).toBe('sent immediately'), wait);
    } finally {
      clients.closeAll();
      await slow.close();
    }
  });
});

describe('read-only enforcement happens on the server', () => {
  let server: TestServer;
  const clients = clientTracker();

  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(async () => {
    clients.closeAll();
    await server.close();
  });

  it('a viewer receives live edits but nothing a viewer sends ever changes the document', async () => {
    const owner = clients.create(server, DOC_ID);
    const viewer = clients.create(server, DOC_ID, { user: vera });
    await vi.waitFor(() => expect([owner.phase(), viewer.phase()]).toEqual(['synced', 'synced']), wait);
    expect(viewer.controller.getSnapshot().readOnly).toBe(true);

    owner.text.insert(0, 'owner text');
    await vi.waitFor(() => expect(viewer.text.toString()).toBe('owner text'), wait); // reading works

    // A modified client bypasses the disabled toolbar and writes anyway.
    viewer.text.insert(0, 'VIEWER TAMPERING ');
    viewer.controller.disconnect();
    viewer.controller.connect(); // even a full handshake (sync step 2 with her extra state)
    await new Promise((r) => setTimeout(r, 300));

    expect(owner.text.toString()).toBe('owner text');
    const late = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(late.text.toString()).toBe('owner text'), wait);
    expect(late.text.toString()).not.toContain('TAMPERING');
    // And the viewer is never told her tampering was stored.
    expect(viewer.phase()).not.toBe('synced');
  });
});

describe('hostile input', () => {
  let server: TestServer;
  const clients = clientTracker();

  afterEach(async () => {
    clients.closeAll();
    await server?.close();
  });

  it('closes only the offending connection on a malformed binary message; the room keeps working', async () => {
    server = await startTestServer();
    const good = clients.create(server, DOC_ID);
    await vi.waitFor(() => expect(good.phase()).toBe('synced'), wait);

    const bad = rawConnect(server, DOC_ID, { token: bob.token });
    await bad.opened;
    bad.send(new Uint8Array([0, 2, 255, 255, 255, 255, 255, 255, 255, 255, 255, 12])); // sync/update with garbage
    expect((await bad.closed).code).toBe(CloseCode.InvalidData);

    good.text.insert(0, 'still alive');
    await vi.waitFor(() => expect(good.phase()).toBe('synced'), wait);
    const check = clients.create(server, DOC_ID, { user: bob });
    await vi.waitFor(() => expect(check.text.toString()).toBe('still alive'), wait);
  });

  it('refuses text frames', async () => {
    server = await startTestServer();
    const raw = rawConnect(server, DOC_ID, { token: alice.token });
    await raw.opened;
    raw.send('{"hello":"world"}');
    expect((await raw.closed).code).toBe(CloseCode.InvalidData);
  });

  it('refuses a message over the size limit (1009)', async () => {
    server = await startTestServer({ env: { MAX_MESSAGE_BYTES: '1024' } });
    const raw = rawConnect(server, DOC_ID, { token: alice.token });
    await raw.opened;
    raw.send(new Uint8Array(4096));
    expect((await raw.closed).code).toBe(CloseCode.MessageTooBig);
  });

  it('drops a client that floods the server with messages (1008)', async () => {
    server = await startTestServer({ env: { MAX_MESSAGES_PER_SECOND: '20' } });
    const raw = rawConnect(server, DOC_ID, { token: alice.token });
    await raw.opened;
    await new Promise((r) => setTimeout(r, 100)); // let authorisation finish
    const query = encoding.createEncoder();
    encoding.writeVarUint(query, MessageType.QueryAwareness);
    const frame = encoding.toUint8Array(query);
    for (let i = 0; i < 200; i++) raw.send(frame);
    expect((await raw.closed).code).toBe(CloseCode.PolicyViolation);
  });

  it('presence: identity is rewritten from the authenticated user and other users\' slots cannot be overwritten', async () => {
    server = await startTestServer();
    const observer = clients.create(server, DOC_ID, { user: vera });
    const honest = clients.create(server, DOC_ID);
    honest.controller.provider.awareness.setLocalStateField('user', { name: 'Alice (client-chosen name)', color: '#000' });
    await vi.waitFor(() => expect(observer.phase()).toBe('synced'), wait);

    // The attacker (bob) forges awareness for Alice's client id and also claims a fake identity for himself.
    const attacker = rawConnect(server, DOC_ID, { token: bob.token });
    await attacker.opened;
    await new Promise((r) => setTimeout(r, 100));
    const forge = (clientId: number, name: string) => {
      const awareness = new awarenessProtocol.Awareness(new Y.Doc());
      const payload = encoding.createEncoder();
      encoding.writeVarUint(payload, 1);
      encoding.writeVarUint(payload, clientId);
      encoding.writeVarUint(payload, 999999); // a huge clock, to "win" against the real state
      encoding.writeVarString(payload, JSON.stringify({ user: { id: 'alice', name, color: '#f00' }, typing: true }));
      awareness.destroy();
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MessageType.Awareness);
      encoding.writeVarUint8Array(frame, encoding.toUint8Array(payload));
      attacker.send(encoding.toUint8Array(frame));
    };
    forge(honest.ydoc.clientID, 'HACKED'); // overwrite Alice's slot
    forge(424242, 'Totally Alice'); // own fresh slot, with a stolen identity

    await vi.waitFor(() => {
      const states = [...observer.controller.provider.awareness.getStates().entries()];
      const forged = states.find(([id]) => id === 424242);
      expect(forged?.[1]?.user).toMatchObject({ id: 'bob', name: 'Bob' }); // server-assigned, not the claimed one
    }, wait);
    const alicesSlot = observer.controller.provider.awareness.getStates().get(honest.ydoc.clientID);
    expect(JSON.stringify(alicesSlot)).not.toContain('HACKED');
    expect(alicesSlot?.user).toMatchObject({ id: 'alice', name: 'Alice' });

    // The sync side of the same connection is untouched by all this.
    const doc = new Y.Doc();
    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MessageType.Sync);
    syncProtocol.writeSyncStep1(step1, doc);
    attacker.send(encoding.toUint8Array(step1));
  });
});
