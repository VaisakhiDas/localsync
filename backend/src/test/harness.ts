import net from 'node:net';
import { SyncController } from '@localsync/shared/sync';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { loadConfig } from '../config';
import { silentLogger } from '../logger';
import { createMemoryPersistence } from '../realtime/memoryPersistence';
import type { Authorizer, DocumentAccess, DocumentPersistence } from '../realtime/types';
import { startServer, type RunningServer } from '../server';

export const ORIGIN = 'http://localhost:5173';
export const DOC_ID = '11111111-1111-4111-8111-111111111111';

export interface TestUser extends DocumentAccess {
  token: string;
}

/** Authorises by `?token=`; unknown tokens get 4401, documents in `deny` get 4403. Roles come from the SERVER side table. */
export function createStaticAuthorizer(users: TestUser[], deny: string[] = []): Authorizer {
  return {
    async authorize(request, documentId) {
      const token = new URL(request.url ?? '/', 'http://x').searchParams.get('token');
      const user = users.find((u) => u.token === token);
      if (!user) return { ok: false, code: 4401, reason: 'Authentication required' };
      if (deny.includes(documentId)) return { ok: false, code: 4403, reason: 'Access denied' };
      return { ok: true, access: { userId: user.userId, displayName: user.displayName, role: user.role } };
    },
  };
}

export const alice: TestUser = { token: 'alice-token', userId: 'alice', displayName: 'Alice', role: 'owner' };
export const bob: TestUser = { token: 'bob-token', userId: 'bob', displayName: 'Bob', role: 'editor' };
export const vera: TestUser = { token: 'vera-token', userId: 'vera', displayName: 'Vera', role: 'viewer' };

export interface TestServer extends RunningServer {
  persistence: DocumentPersistence;
  url: string;
}

export async function startTestServer(
  options: {
    authorizer?: Authorizer;
    persistence?: DocumentPersistence;
    env?: Record<string, string>;
    allowMissingOrigin?: boolean;
  } = {},
): Promise<TestServer> {
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    ALLOWED_ORIGINS: ORIGIN,
    LOG_LEVEL: 'silent',
    PERSIST_DEBOUNCE_MS: '20',
    PERSIST_MAX_WAIT_MS: '200',
    ROOM_IDLE_MS: '60',
    SHUTDOWN_TIMEOUT_MS: '3000',
    ...options.env,
  });
  const persistence = options.persistence ?? createMemoryPersistence();
  const running = await startServer({
    config,
    log: silentLogger,
    authorizer: options.authorizer ?? createStaticAuthorizer([alice, bob, vera]),
    persistence,
    allowMissingOrigin: options.allowMissingOrigin,
  });
  return { ...running, persistence, url: `ws://127.0.0.1:${running.port}` };
}

/** A real client: the same SyncController the browser uses, talking over a real socket. */
export function createClient(
  server: Pick<TestServer, 'url'>,
  documentId: string,
  options: { user?: TestUser | null; origin?: string; connect?: boolean; cookie?: string } = {},
) {
  const user = options.user === undefined ? (options.cookie ? null : alice) : options.user;
  const origin = options.origin ?? ORIGIN;
  class OriginWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { Origin: origin, ...(options.cookie ? { Cookie: options.cookie } : {}) } });
    }
  }
  const ydoc = new Y.Doc();
  const controller = new SyncController({
    serverUrl: `${server.url}/collab`,
    documentId,
    ydoc,
    WebSocketPolyfill: OriginWebSocket as unknown as typeof globalThis.WebSocket,
    params: user ? { token: user.token } : undefined,
    maxBackoffTime: 80,
  });
  if (options.connect !== false) controller.connect();
  return {
    ydoc,
    controller,
    text: ydoc.getText('t'),
    phase: () => controller.getSnapshot().phase,
    close: () => controller.destroy(),
  };
}

export type TestClient = ReturnType<typeof createClient>;

/** Collects every client so a test can tear them all down, even when an assertion throws. */
export function clientTracker() {
  const all: TestClient[] = [];
  return {
    create(...args: Parameters<typeof createClient>) {
      const client = createClient(...args);
      all.push(client);
      return client;
    },
    closeAll() {
      all.splice(0).forEach((c) => c.close());
    },
  };
}

/** Test persistence whose writes can be delayed or made to fail on demand. */
export function createControllablePersistence() {
  const inner = createMemoryPersistence();
  const control = {
    failing: false,
    gate: null as Promise<void> | null,
    stores: 0,
  };
  const persistence: DocumentPersistence = {
    load: (id) => inner.load(id),
    async store(id, state) {
      control.stores++;
      if (control.gate) await control.gate;
      if (control.failing) throw new Error('simulated storage failure');
      await inner.store(id, state);
    },
  };
  return { persistence, control, inner };
}

/**
 * A TCP proxy in front of the server. `sever()` destroys every open socket WITHOUT a WebSocket close
 * frame: exactly what a dropped Wi-Fi connection or a killed process looks like to the client.
 */
export async function createProxy(targetPort: number) {
  const sockets = new Set<net.Socket>();
  const proxy = net.createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      s.on('error', () => s.destroy());
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const port = (proxy.address() as net.AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    sever: () => sockets.forEach((s) => s.destroy()),
    close: () => new Promise<void>((resolve) => {
      sockets.forEach((s) => s.destroy());
      proxy.close(() => resolve());
    }),
  };
}

/** A bare WebSocket (no Yjs client) for sending hand-crafted, hostile or malformed frames. */
export function rawConnect(
  server: Pick<TestServer, 'url'>,
  documentId: string,
  options: { token?: string; origin?: string | null; path?: string } = {},
) {
  const query = options.token ? `?token=${options.token}` : '';
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN;
  const ws = new WebSocket(`${server.url}${options.path ?? `/collab/${documentId}`}${query}`, { headers });
  const received: Uint8Array[] = [];
  ws.on('message', (data: Buffer) => received.push(new Uint8Array(data)));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  const rejected = new Promise<number>((resolve) => ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)));
  return { ws, received, opened, closed, rejected, send: (data: Uint8Array | string) => ws.send(data) };
}
