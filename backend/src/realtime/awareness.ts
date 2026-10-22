import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/**
 * Awareness (presence) messages are produced by clients, so they are untrusted: a client could
 * claim to be someone else or write to another user's slot. Before relaying we rewrite the
 * identity from what the SERVER knows about the connection and keep only known fields.
 */

export interface TrustedIdentity {
  id: string;
  name: string;
  color: string;
}

interface AwarenessEntry {
  clientId: number;
  clock: number;
  state: Record<string, unknown> | null;
}

const MAX_ENTRIES = 8;
const MAX_STATE_BYTES = 2048;
/** `user` is server-controlled; `cursor` and `typing` are the only client-supplied fields we relay. */
const CLIENT_FIELDS = ['cursor', 'typing'] as const;

/** Stable pseudo-random colour per user, computed server-side so it cannot be spoofed. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `hsl(${hash % 360} 65% 42%)`;
}

export function decodeAwarenessUpdate(update: Uint8Array): AwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  if (count > MAX_ENTRIES) throw new Error('too many awareness entries');
  const entries: AwarenessEntry[] = [];
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const parsed: unknown = JSON.parse(decoding.readVarString(decoder));
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('bad awareness state');
    entries.push({ clientId, clock, state: parsed as Record<string, unknown> | null });
  }
  return entries;
}

export function encodeAwarenessEntries(entries: AwarenessEntry[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const { clientId, clock, state } of entries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return encoding.toUint8Array(encoder);
}

/**
 * @param owns   whether this connection may write the given awareness client id (its own, or an unclaimed one)
 * @returns the sanitised update to apply, or null if nothing survived.
 */
export function sanitiseAwarenessUpdate(
  update: Uint8Array,
  identity: TrustedIdentity,
  owns: (clientId: number) => boolean,
): Uint8Array | null {
  const kept: AwarenessEntry[] = [];
  for (const entry of decodeAwarenessUpdate(update)) {
    if (!owns(entry.clientId)) continue; // would overwrite someone else's presence
    if (entry.state === null) {
      kept.push(entry); // "I left"
      continue;
    }
    const state: Record<string, unknown> = { user: { id: identity.id, name: identity.name, color: identity.color } };
    for (const field of CLIENT_FIELDS) if (field in entry.state) state[field] = entry.state[field];
    if (JSON.stringify(state).length > MAX_STATE_BYTES) continue;
    kept.push({ ...entry, state });
  }
  return kept.length ? encodeAwarenessEntries(kept) : null;
}
