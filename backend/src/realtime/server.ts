import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CloseCode, COLLAB_PATH, isDocumentId } from '@localsync/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type * as Y from 'yjs';
import type { Config } from '../config';
import { errorFields, type Logger } from '../logger';
import type { Connection, Room } from './room';
import { RoomManager } from './rooms';
import type { Authorizer, DocumentPersistence } from './types';

export interface RealtimeDeps {
  authorizer: Authorizer;
  persistence: DocumentPersistence;
  config: Pick<
    Config,
    | 'ALLOWED_ORIGINS'
    | 'MAX_MESSAGE_BYTES'
    | 'MAX_MESSAGES_PER_SECOND'
    | 'PERSIST_DEBOUNCE_MS'
    | 'PERSIST_MAX_WAIT_MS'
    | 'ROOM_IDLE_MS'
    | 'SHUTDOWN_TIMEOUT_MS'
  >;
  log: Logger;
  /** Allow upgrades with no Origin header (non-browser clients). Browsers always send one. Default: false. */
  allowMissingOrigin?: boolean;
}

export interface RealtimeServer {
  /** Wire this to the HTTP server's 'upgrade' event. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Drops one user's connections to a document; they reconnect and are re-authorised (permission changes). */
  disconnectUser(documentId: string, userId: string): void;
  /** Drops every connection that belongs to one login session (logout). */
  disconnectSession(sessionId: string): void;
  /** The document was deleted: close its room for everyone (permanent 4403) without saving. */
  closeDocument(documentId: string): void;
  /** Runs `fn` against the live merged document (loading it if necessary). */
  withDocument<T>(documentId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T>;
  stats(): { rooms: number; connections: number };
  /** Graceful shutdown: stop accepting, persist everything, close sockets with 1001. */
  close(): Promise<void>;
}

const HEARTBEAT_MS = 30_000;
const AUTH_TIMEOUT_MS = 5_000;
/** Messages that arrive while we are still authorising are buffered, up to this many. */
const MAX_PENDING_MESSAGES = 32;

const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

export function createRealtimeServer(deps: RealtimeDeps): RealtimeServer {
  const { authorizer, config, log } = deps;
  const rooms = new RoomManager({ persistence: deps.persistence, config, log });
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.MAX_MESSAGE_BYTES });
  const connections = new Set<Connection>();
  let closing = false;

  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.isAlive) {
        conn.ws.terminate(); // no pong since the last round: the peer is gone
        continue;
      }
      conn.isAlive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const rejectHttp = (socket: Duplex, status: number, text: string) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  /**
   * Browsers cannot read the HTTP status of a failed WebSocket handshake, so for authentication
   * and authorisation failures we COMPLETE the handshake and then close with an application
   * code (4401/4403). y-websocket understands those as "do not retry".
   */
  async function onConnection(ws: WebSocket, request: IncomingMessage, documentId: string) {
    ws.on('error', (err) => log.debug('socket error', errorFields(err)));

    // Messages can arrive while we are still checking permissions (the client sends its sync
    // step 1 the instant the socket opens). Buffer them; dropping them would stall the handshake.
    const pending: Uint8Array[] = [];
    let dispatch: ((data: Uint8Array) => void) | null = null;
    let wasClosed = false;
    ws.on('close', () => (wasClosed = true));
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return void ws.close(CloseCode.InvalidData, 'Binary frames only'); // 1007: we never accept text
      if (dispatch) return dispatch(toBytes(data));
      if (pending.length >= MAX_PENDING_MESSAGES) return void ws.close(CloseCode.PolicyViolation, 'Too many messages');
      pending.push(toBytes(data));
    });

    let conn: Connection | undefined;
    let room: Room | undefined;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('authorisation timed out')), AUTH_TIMEOUT_MS).unref(),
      );
      const result = await Promise.race([authorizer.authorize(request, documentId), timeout]);
      if (!result.ok) {
        log.info('connection refused', { documentId, code: result.code });
        ws.close(result.code, result.reason);
        return;
      }
      if (wasClosed || closing) return ws.close(CloseCode.GoingAway, 'Server shutting down');

      room = await rooms.acquire(documentId);
      if (wasClosed || room.state !== 'open') return ws.close(CloseCode.TryAgainLater, 'Try again');

      const joined = room.join(ws, result.access);
      conn = joined;
      connections.add(joined);
      const target = room;
      dispatch = (data) => target.handle(joined, data);
      ws.on('pong', () => (joined.isAlive = true));
      ws.on('close', () => {
        connections.delete(joined);
        target.leave(joined);
      });
      log.info('client connected', { documentId, userId: result.access.userId, role: result.access.role });
      for (const data of pending.splice(0)) dispatch(data);
    } catch (err) {
      log.error('connection setup failed', { documentId, ...errorFields(err) });
      if (conn && room) room.leave(conn);
      ws.close(CloseCode.InternalError, 'Server error');
    }
  }

  return {
    handleUpgrade(request, socket, head) {
      if (closing) return rejectHttp(socket, 503, 'Service Unavailable');

      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = new RegExp(`^${COLLAB_PATH}/([^/]+)$`).exec(url.pathname);
      if (!match) return rejectHttp(socket, 404, 'Not Found');
      // Never trust the id as a path: reject anything that is not a UUID before touching storage.
      const documentId = decodeURIComponent(match[1]!);

      // Cross-site WebSocket hijacking defence: a page on another origin can make the browser
      // open this socket carrying the user's cookies, so only our own front-end origins are allowed.
      const origin = request.headers.origin;
      const originAllowed = origin ? config.ALLOWED_ORIGINS.includes(origin) : deps.allowMissingOrigin === true;
      if (!originAllowed) {
        log.warn('rejected upgrade: origin not allowed', { origin: origin ?? null });
        return rejectHttp(socket, 403, 'Forbidden');
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        // Invalid ids get the same close as "no access": nothing reveals whether a document exists.
        if (!isDocumentId(documentId)) return void ws.close(CloseCode.Forbidden, 'Access denied');
        void onConnection(ws, request, documentId);
      });
    },

    disconnectUser(documentId, userId) {
      for (const conn of connections) {
        if (conn.access.userId === userId && conn.documentId === documentId) {
          conn.ws.close(CloseCode.PermissionsChanged, 'Permissions changed');
        }
      }
    },

    disconnectSession(sessionId) {
      for (const conn of connections) {
        if (conn.access.sessionId === sessionId) conn.ws.close(CloseCode.Unauthenticated, 'Signed out');
      }
    },

    closeDocument(documentId) {
      rooms.discard(documentId);
    },

    async withDocument(documentId, fn) {
      const room = await rooms.acquire(documentId);
      try {
        return await fn(room.doc);
      } finally {
        rooms.releaseIfEmpty(room);
      }
    },

    stats: () => ({ rooms: rooms.roomCount, connections: rooms.connectionCount }),

    async close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      // Persist and close everything, but never hang forever on a stuck database or socket.
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, config.SHUTDOWN_TIMEOUT_MS).unref());
      await Promise.race([rooms.closeAll(), timeout]);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
