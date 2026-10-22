import { canEdit, CloseCode, encodeAck, MessageType } from '@localsync/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as authProtocol from 'y-protocols/auth';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Config } from '../config';
import { errorFields, type Logger } from '../logger';
import { colorForUser, sanitiseAwarenessUpdate, type TrustedIdentity } from './awareness';
import type { DocumentAccess, DocumentPersistence } from './types';

/** One WebSocket attached to a room, plus everything the SERVER knows about its owner. */
export interface Connection {
  readonly ws: WebSocket;
  readonly documentId: string;
  readonly access: DocumentAccess;
  readonly identity: TrustedIdentity;
  /** Read-only connections may receive everything but never change the document. */
  readonly canWrite: boolean;
  /** Awareness client ids this connection has written (cleared from presence when it leaves). */
  readonly controlledIds: Set<number>;
  isAlive: boolean;
  windowStart: number;
  windowCount: number;
}

export interface RoomDeps {
  persistence: DocumentPersistence;
  config: Pick<Config, 'PERSIST_DEBOUNCE_MS' | 'PERSIST_MAX_WAIT_MS' | 'MAX_MESSAGES_PER_SECOND'>;
  log: Logger;
  /** Called when the last connection leaves. */
  onEmpty(room: Room): void;
  /** Largest amount of buffered outbound data tolerated before a slow client is dropped. */
  maxBufferedBytes?: number;
}

const LOAD_ORIGIN = Symbol('load-from-persistence');
const DEFAULT_MAX_BUFFERED = 16 * 1024 * 1024;

const frame = (type: number, write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
};

/**
 * One live document on the server: the merged Y.Doc, who is connected, and how it is persisted.
 *
 * The server never "decides" what text says: it applies Yjs updates (a CRDT merges them in any
 * order, any number of times) and relays what changed. Its jobs are access control, fan-out,
 * presence hygiene and durability.
 */
export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly connections = new Set<Connection>();
  readonly ready: Promise<void>;
  /** Resolves once the room has been flushed, destroyed and removed from the manager. */
  readonly closed: Promise<void>;
  state: 'loading' | 'open' | 'closing' | 'closed' = 'loading';

  private markClosed!: () => void;
  private dirty = false;
  private failures = 0;
  private persistChain: Promise<void> = Promise.resolve();
  private debounceTimer: NodeJS.Timeout | undefined;
  private maxWaitTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  /** Snapshot of exactly what is durably stored. Clients compare it with their own state. */
  private persistedAck: Uint8Array;

  constructor(
    readonly id: string,
    private readonly deps: RoomDeps,
  ) {
    this.closed = new Promise((resolve) => (this.markClosed = resolve));
    this.awareness.setLocalState(null); // the server itself has no presence
    this.persistedAck = encodeAck(this.doc);
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.ready = this.load();
    this.ready.catch(() => undefined); // the creator handles the failure; avoid an unhandled rejection
  }

  private async load(): Promise<void> {
    const stored = await this.deps.persistence.load(this.id);
    if (stored) Y.applyUpdate(this.doc, stored, LOAD_ORIGIN);
    this.persistedAck = encodeAck(this.doc);
    this.state = 'open';
  }

  // --- membership -----------------------------------------------------------

  join(ws: WebSocket, access: DocumentAccess): Connection {
    const identity: TrustedIdentity = { id: access.userId, name: access.displayName, color: colorForUser(access.userId) };
    const conn: Connection = {
      ws,
      documentId: this.id,
      access,
      identity,
      canWrite: canEdit(access.role),
      controlledIds: new Set(),
      isAlive: true,
      windowStart: Date.now(),
      windowCount: 0,
    };
    this.connections.add(conn);

    // Handshake: tell the client which operations we have; it answers with the ones we lack.
    this.send(conn, frame(MessageType.Sync, (e) => syncProtocol.writeSyncStep1(e, this.doc)));
    const present = [...this.awareness.getStates().keys()];
    if (present.length > 0) {
      this.send(conn, frame(MessageType.Awareness, (e) => encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, present))));
    }
    if (!conn.canWrite) this.sendReadOnlyNotice(conn);
    return conn;
  }

  leave(conn: Connection): void {
    if (!this.connections.delete(conn)) return;
    // Everyone sees this user's cursor disappear immediately.
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.controlledIds], null);
    if (this.connections.size === 0) this.deps.onEmpty(this);
  }

  /** Closes every connection of one user (membership revoked or role changed). */
  disconnectUser(userId: string, code: number, reason: string): void {
    for (const conn of this.connections) if (conn.access.userId === userId) conn.ws.close(code, reason);
  }

  // --- inbound messages -----------------------------------------------------

  /** Handles one binary frame from `conn`. Never throws; protocol violations close that connection only. */
  handle(conn: Connection, data: Uint8Array): void {
    try {
      const now = Date.now();
      if (now - conn.windowStart >= 1000) {
        conn.windowStart = now;
        conn.windowCount = 0;
      }
      if (++conn.windowCount > this.deps.config.MAX_MESSAGES_PER_SECOND) {
        conn.ws.close(CloseCode.PolicyViolation, 'Too many messages');
        return;
      }

      const decoder = decoding.createDecoder(data);
      switch (decoding.readVarUint(decoder)) {
        case MessageType.Sync:
          this.handleSync(conn, decoder);
          break;
        case MessageType.Awareness:
          this.handleAwareness(conn, decoding.readVarUint8Array(decoder));
          break;
        case MessageType.QueryAwareness: {
          const ids = [...this.awareness.getStates().keys()];
          this.send(conn, frame(MessageType.Awareness, (e) => encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids))));
          break;
        }
        default:
          // Auth/Ack flow server -> client only; anything else is unknown. Ignore rather than trust.
          this.deps.log.debug('ignored unknown message type', { documentId: this.id });
      }
    } catch (err) {
      this.deps.log.warn('invalid message; closing connection', { documentId: this.id, ...errorFields(err) });
      conn.ws.close(CloseCode.InvalidData, 'Invalid message');
    }
  }

  private handleSync(conn: Connection, decoder: decoding.Decoder): void {
    const syncType = decoding.readVarUint(decoder);
    switch (syncType) {
      case syncProtocol.messageYjsSyncStep1: {
        // Reading is always allowed: reply with what the client is missing.
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MessageType.Sync);
        syncProtocol.readSyncStep1(decoder, reply, this.doc);
        this.send(conn, encoding.toUint8Array(reply));
        this.sendAck(conn);
        break;
      }
      case syncProtocol.messageYjsSyncStep2:
      case syncProtocol.messageYjsUpdate: {
        if (!conn.canWrite) {
          decoding.readVarUint8Array(decoder); // consume and DISCARD: a viewer's writes never reach the document
          this.sendReadOnlyNotice(conn);
          break;
        }
        let failed: Error | null = null;
        // The connection is the transaction origin, so we do not echo the update back to its sender.
        syncProtocol.readSyncStep2(decoder, this.doc, conn, (error) => (failed = error));
        if (failed) throw failed;
        // After the handshake's step 2, tell the client what is durably stored (live updates are
        // acknowledged by the broadcast that follows each persist).
        if (syncType === syncProtocol.messageYjsSyncStep2) this.sendAck(conn);
        break;
      }
      default:
        throw new Error(`unknown sync message type ${syncType}`);
    }
  }

  private handleAwareness(conn: Connection, update: Uint8Array): void {
    const owns = (clientId: number) =>
      conn.controlledIds.has(clientId) || ![...this.connections].some((c) => c !== conn && c.controlledIds.has(clientId));
    const clean = sanitiseAwarenessUpdate(update, conn.identity, owns);
    if (clean) awarenessProtocol.applyAwarenessUpdate(this.awareness, clean, conn);
  }

  // --- outbound -------------------------------------------------------------

  private send(conn: Connection, data: Uint8Array): void {
    const { ws } = conn;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > (this.deps.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED)) {
      ws.close(CloseCode.TryAgainLater, 'Client too slow'); // it reconnects and re-syncs from its state vector
      return;
    }
    ws.send(data, { binary: true }, (err) => {
      if (err) ws.terminate();
    });
  }

  private sendAck(conn: Connection): void {
    this.send(conn, frame(MessageType.Ack, (e) => encoding.writeVarUint8Array(e, this.persistedAck)));
  }

  private sendReadOnlyNotice(conn: Connection): void {
    this.send(conn, frame(MessageType.Auth, (e) => authProtocol.writePermissionDenied(e, 'read-only')));
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return;
    this.dirty = true;
    this.schedulePersist();
    // Relay what CHANGED, re-encoded by the server: never the client's raw bytes.
    const message = frame(MessageType.Sync, (e) => syncProtocol.writeUpdate(e, update));
    for (const conn of this.connections) if (conn !== origin) this.send(conn, message);
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const source = [...this.connections].find((c) => c === origin);
    if (source) {
      added.forEach((id) => source.controlledIds.add(id));
      removed.forEach((id) => source.controlledIds.delete(id));
    }
    const changed = [...added, ...updated, ...removed];
    const message = frame(MessageType.Awareness, (e) => encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
    // Also to the sender: its provider treats "no message for 30 s" as a dead connection, and
    // the echo of its own periodic presence refresh is what keeps a lone editor's socket alive.
    for (const conn of this.connections) this.send(conn, message);
  };

  private broadcastAck(): void {
    for (const conn of this.connections) this.sendAck(conn);
  }

  // --- persistence ----------------------------------------------------------

  private schedulePersist(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.flush(), this.deps.config.PERSIST_DEBOUNCE_MS);
    // A steady stream of edits keeps resetting the debounce; this guarantees progress.
    this.maxWaitTimer ??= setTimeout(() => void this.flush(), this.deps.config.PERSIST_MAX_WAIT_MS);
  }

  private clearTimers(): void {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.maxWaitTimer);
    clearTimeout(this.retryTimer);
    this.maxWaitTimer = undefined;
  }

  /** Writes the merged state if anything changed. Writes are serialised and never overlap. */
  flush(): Promise<void> {
    this.clearTimers();
    this.persistChain = this.persistChain.then(() => this.persistOnce());
    return this.persistChain;
  }

  private async persistOnce(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    // Encoded in the same tick, so the acknowledgement describes exactly what we are about to store.
    const state = Y.encodeStateAsUpdate(this.doc);
    const ack = encodeAck(this.doc);
    try {
      await this.deps.persistence.store(this.id, state);
    } catch (err) {
      // Not acknowledged: clients keep saying "Syncing" and keep their data. Retry with backoff.
      this.dirty = true;
      this.failures++;
      this.deps.log.error('could not persist document', { documentId: this.id, failures: this.failures, ...errorFields(err) });
      if (this.state !== 'closed') {
        this.retryTimer = setTimeout(() => void this.flush(), Math.min(30_000, 500 * 2 ** this.failures));
      }
      return;
    }
    this.failures = 0;
    this.persistedAck = ack;
    this.broadcastAck();
  }

  // --- lifecycle ------------------------------------------------------------

  /** Stops admitting connections and closes the existing ones. Follow with flush() and destroy(). */
  beginClose(code: number = CloseCode.GoingAway, reason = 'Server shutting down'): void {
    if (this.state === 'closing' || this.state === 'closed') return;
    this.state = 'closing';
    for (const conn of this.connections) conn.ws.close(code, reason);
  }

  /** The document was deleted: drop everyone and forget the state (persisting would hit a missing row). */
  discard(): void {
    this.dirty = false;
    this.clearTimers();
    this.beginClose(CloseCode.Forbidden, 'Document deleted');
  }

  destroy(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.clearTimers();
    this.doc.off('update', this.onDocUpdate);
    this.awareness.destroy();
    this.doc.destroy();
    this.markClosed();
  }
}
