import type { Awareness } from 'y-protocols/awareness';

export interface Peer {
  /** The account id (server-assigned: a client cannot claim to be someone else). */
  userId: string;
  name: string;
  color: string;
  typing: boolean;
}

interface AwarenessState {
  user?: { id?: unknown; name?: unknown; color?: unknown };
  typing?: unknown;
}

/**
 * Everyone else who currently has this document open, one entry per person (two tabs = one person).
 * `selfUserId` hides the signed-in user's OWN other tabs/devices: "who else is here" is about other people.
 */
export function readPeers(awareness: Awareness, selfUserId?: string): Peer[] {
  const byUser = new Map<string, Peer>();
  for (const [clientId, raw] of awareness.getStates() as Map<number, AwarenessState | null>) {
    if (clientId === awareness.clientID) continue;
    // Presence comes from other clients: treat it as untrusted and never let it break rendering.
    if (!raw || typeof raw !== 'object') continue;
    const { user } = raw;
    if (!user || typeof user.id !== 'string' || typeof user.name !== 'string') continue;
    if (user.id === selfUserId) continue;
    const existing = byUser.get(user.id);
    const typing = raw.typing === true;
    byUser.set(user.id, {
      userId: user.id,
      name: user.name,
      color: typeof user.color === 'string' ? user.color : '#52525b',
      typing: typing || (existing?.typing ?? false),
    });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * An external store over awareness for useSyncExternalStore. The snapshot is cached so React sees
 * a stable reference between changes. Listeners attach only on subscribe (no side effects on creation).
 */
export function createPresenceStore(awareness: Awareness, selfUserId?: string) {
  let snapshot: Peer[] = readPeers(awareness, selfUserId);
  return {
    getSnapshot: () => snapshot,
    subscribe(onChange: () => void) {
      const handler = () => {
        const next = readPeers(awareness, selfUserId);
        if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
        snapshot = next;
        onChange();
      };
      awareness.on('change', handler);
      return () => awareness.off('change', handler);
    },
  };
}

/** "Typing" is ephemeral: set while the user edits, cleared after a short pause (and gone when they leave). */
export function createTypingSignal(awareness: Awareness, idleMs = 1500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    pulse() {
      if (awareness.getLocalState()?.typing !== true) awareness.setLocalStateField('typing', true);
      clearTimeout(timer);
      timer = setTimeout(() => awareness.setLocalStateField('typing', false), idleMs);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
