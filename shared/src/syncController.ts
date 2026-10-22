/**
 * Client side of synchronisation: owns the network provider for ONE Y.Doc and turns
 * low-level socket events into an honest, UI-friendly status.
 *
 * Four separate things are easy to confuse; this class keeps them apart:
 *   1. the editor UI           (TipTap / ProseMirror, elsewhere)
 *   2. the shared state        (the Y.Doc: a CRDT, edited locally, always)
 *   3. the merge semantics     (Yjs: state-vector exchange makes replicas converge)
 *   4. the transport           (this provider: just moves bytes; may be down at any time)
 *
 * Nothing here can lose data: when the socket is down, edits simply accumulate in the Y.Doc
 * (and in IndexedDB). On reconnect the Yjs handshake sends whatever the server is missing.
 * There is intentionally NO outbound operation queue.
 */
import * as decoding from 'lib0/decoding';
import type { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { ackCovers, decodeAck, MessageType } from './protocol';

export type SyncPhase =
  /** No connection (network down, server unreachable, or not started). Local editing still works. */
  | 'offline'
  /** Opening the socket / running the initial Yjs handshake. */
  | 'connecting'
  /** Connected, but the server has not yet durably stored everything on this device. */
  | 'syncing'
  /** Connected and the server has durably stored everything on this device. */
  | 'synced'
  /** The server refused us permanently (sign-in expired, or no access). */
  | 'denied';

export interface SyncSnapshot {
  readonly phase: SyncPhase;
  /** The WebSocket is open. */
  readonly connected: boolean;
  /** The server's last acknowledgement covers this device's whole document. */
  readonly upToDate: boolean;
  /** The server said our edits are ignored (read-only role). */
  readonly readOnly: boolean;
  readonly denied: { readonly code: number; readonly reason: string } | null;
}

/** Abstracts `navigator.onLine` + window online/offline events so the controller is testable in Node. */
export interface NetworkMonitor {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface SyncControllerOptions {
  /** e.g. `wss://example.com/collab` (the document id is appended). */
  serverUrl: string;
  documentId: string;
  ydoc: Y.Doc;
  awareness?: Awareness;
  /** Node needs `ws`'s WebSocket here; browsers use the built-in. */
  WebSocketPolyfill?: typeof WebSocket;
  network?: NetworkMonitor;
  maxBackoffTime?: number;
  /** Extra query-string parameters for the WebSocket URL (interim token auth). */
  params?: Record<string, string>;
}

const sameSnapshot = (a: SyncSnapshot, b: SyncSnapshot) =>
  a.phase === b.phase &&
  a.connected === b.connected &&
  a.upToDate === b.upToDate &&
  a.readOnly === b.readOnly &&
  a.denied?.code === b.denied?.code;

export class SyncController {
  readonly provider: WebsocketProvider;
  private readonly ydoc: Y.Doc;
  private readonly listeners = new Set<() => void>();
  private readonly stopNetwork: (() => void) | undefined;

  private snapshot: SyncSnapshot;
  private wantConnected = false;
  private networkOnline = true;
  private attemptFailed = false;
  private upToDate = false;
  private readOnly = false;
  private denied: SyncSnapshot['denied'] = null;
  private destroyed = false;

  constructor(options: SyncControllerOptions) {
    this.ydoc = options.ydoc;
    this.provider = new WebsocketProvider(options.serverUrl, options.documentId, options.ydoc, {
      connect: false,
      awareness: options.awareness,
      WebSocketPolyfill: options.WebSocketPolyfill,
      maxBackoffTime: options.maxBackoffTime ?? 5000,
      params: options.params,
      // Cross-tab BroadcastChannel sync would let a tab learn about changes that the server has
      // never seen, which would make our "acknowledged by the server" status untrue.
      disableBc: true,
    });

    // The server's durability acknowledgement (our protocol extension).
    this.provider.messageHandlers[MessageType.Ack] = (_encoder, decoder) => {
      this.onAck(decoding.readVarUint8Array(decoder));
    };
    // y-websocket's default handler only console.warn()s; we surface it in the status instead.
    this.provider.messageHandlers[MessageType.Auth] = (_encoder, decoder) => {
      decoding.readVarUint(decoder); // permission-denied discriminator
      decoding.readVarString(decoder); // human-readable reason (not shown: could be server-internal)
      this.readOnly = true;
      this.refresh();
    };

    this.provider.on('status', ({ status }) => {
      if (status === 'connected') {
        // A new connection must earn a fresh acknowledgement: after a server restart the old
        // one may describe data the server no longer has.
        this.attemptFailed = false;
        this.upToDate = false;
        this.readOnly = false;
      }
      this.refresh();
    });
    this.provider.on('sync', () => this.refresh());
    this.provider.on('connection-close', () => {
      this.attemptFailed = true;
      this.refresh();
    });
    this.provider.on('closed', (event) => {
      this.denied = { code: event.code, reason: event.reason };
      this.refresh();
    });

    // Any change that did not come from the server needs a (new) acknowledgement.
    this.ydoc.on('update', this.onDocUpdate);

    this.networkOnline = options.network?.isOnline() ?? true;
    this.stopNetwork = options.network?.subscribe((online) => this.onNetwork(online));
    this.snapshot = this.compute();
  }

  // --- external store contract (useSyncExternalStore) -----------------------

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // --- control ---------------------------------------------------------------

  /** Start (or resume, e.g. after sign-in) synchronising. Safe to call repeatedly. */
  connect(): void {
    if (this.destroyed) return;
    this.wantConnected = true;
    this.denied = null;
    if (this.networkOnline) this.provider.connect();
    this.refresh();
  }

  /** Stop synchronising. Local editing continues; edits wait in the Y.Doc. */
  disconnect(): void {
    this.wantConnected = false;
    this.provider.disconnect();
    this.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopNetwork?.();
    this.ydoc.off('update', this.onDocUpdate);
    this.provider.destroy();
    this.listeners.clear();
  }

  // --- internals -------------------------------------------------------------

  private onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === this.provider) return; // came from the server: nothing new to acknowledge
    if (this.upToDate) {
      this.upToDate = false;
      this.refresh();
    }
  };

  private onAck(bytes: Uint8Array) {
    try {
      this.upToDate = ackCovers(decodeAck(bytes), this.ydoc);
    } catch {
      return; // a malformed ack is ignored; "synced" is never claimed on bad evidence
    }
    this.refresh();
  }

  private onNetwork(online: boolean) {
    this.networkOnline = online;
    if (!online) this.provider.disconnect(); // stop retrying into the void
    else if (this.wantConnected && !this.denied) this.provider.connect();
    this.refresh();
  }

  private compute(): SyncSnapshot {
    const p = this.provider;
    const connected = p.wsconnected;
    let phase: SyncPhase;
    if (this.denied) phase = 'denied';
    else if (connected) phase = !p.synced ? 'connecting' : this.upToDate ? 'synced' : 'syncing';
    else if (this.wantConnected && this.networkOnline && p.wsconnecting && !this.attemptFailed) phase = 'connecting';
    else phase = 'offline';

    return {
      phase,
      connected,
      upToDate: connected && this.upToDate,
      readOnly: this.readOnly,
      denied: this.denied,
    };
  }

  private refresh() {
    if (this.destroyed) return;
    const next = this.compute();
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}
