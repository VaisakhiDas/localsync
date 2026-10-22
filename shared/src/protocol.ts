/**
 * The wire protocol between the browser and the synchronisation server.
 *
 * It is the standard y-websocket protocol (sync, awareness, auth, queryAwareness)
 * plus ONE extension: the server's acknowledgement (`Ack`). Everything else is
 * implemented by the maintained `y-protocols` library on both ends.
 */
import * as Y from 'yjs';

export const MessageType = {
  /** Yjs document sync: step 1 (state vector), step 2 (missing updates), live updates. */
  Sync: 0,
  /** Presence (cursors, names). Ephemeral; never stored. */
  Awareness: 1,
  /** Server -> client: "your writes are not accepted" (read-only role). */
  Auth: 2,
  QueryAwareness: 3,
  /**
   * Server -> client: "everything up to this snapshot is DURABLY STORED on the server".
   * This is what lets the UI say "Synced" truthfully instead of guessing from the socket state.
   */
  Ack: 4,
} as const;

/**
 * WebSocket close codes. y-websocket treats 4400-4499 as PERMANENT (it stops reconnecting),
 * and every other code as transient (exponential-backoff reconnect).
 */
export const CloseCode = {
  Normal: 1000,
  GoingAway: 1001,
  InvalidData: 1007,
  PolicyViolation: 1008,
  MessageTooBig: 1009,
  InternalError: 1011,
  TryAgainLater: 1013,
  /** Permanent: no valid session. The user must sign in again. */
  Unauthenticated: 4401,
  /** Permanent: signed in, but no access to this document (or it does not exist: we never say which). */
  Forbidden: 4403,
  /** Transient: your role changed; reconnect and you will be re-authorised. */
  PermissionsChanged: 4502,
} as const;

/** Path prefix of the document sync endpoint: `/collab/<documentId>`. */
export const COLLAB_PATH = '/collab';

// ---------------------------------------------------------------------------
// Acknowledgements
//
// A Yjs document's identity is (state vector, delete set):
//   - the state vector says "I have seen operations 0..n-1 from every client";
//   - the delete set says which of those operations were deletions.
// Deleting text does NOT advance any state vector, so a delete-only edit is invisible to a
// state-vector comparison. Acknowledgements therefore carry a full Snapshot (both parts).
// ---------------------------------------------------------------------------

export function encodeAck(doc: Y.Doc): Uint8Array {
  return Y.encodeSnapshot(Y.snapshot(doc));
}

export function decodeAck(bytes: Uint8Array): Y.Snapshot {
  return Y.decodeSnapshot(bytes);
}

type Range = [start: number, end: number];

function normalise(items: ReadonlyArray<{ clock: number; len: number }>): Range[] {
  const sorted = items.map((i): Range => [i.clock, i.clock + i.len]).sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** True if every range in `inner` lies inside a single range of `outer` (both sorted and merged). */
function rangesCovered(inner: Range[], outer: Range[]): boolean {
  let j = 0;
  for (const [start, end] of inner) {
    while (j < outer.length && outer[j]![1] < end) j++;
    if (j === outer.length || outer[j]![0] > start) return false;
  }
  return true;
}

/**
 * Has the server acknowledged EVERYTHING in `doc`? True iff the acknowledged snapshot is a
 * superset of the document: it has seen every operation, and every deletion we know about.
 * Because it compares content identity (not message counts), duplicates and re-deliveries
 * cannot make it lie.
 */
export function ackCovers(ack: Y.Snapshot, doc: Y.Doc): boolean {
  const local = Y.snapshot(doc);
  for (const [client, clock] of local.sv) {
    if ((ack.sv.get(client) ?? 0) < clock) return false;
  }
  for (const [client, items] of local.ds.clients) {
    const mine = normalise(items);
    if (mine.length === 0) continue;
    if (!rangesCovered(mine, normalise(ack.ds.clients.get(client) ?? []))) return false;
  }
  return true;
}
