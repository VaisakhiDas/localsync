import { Awareness } from 'y-protocols/awareness';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createPresenceStore, createTypingSignal, readPeers } from './presence';

/** Simulates the server relaying another client's presence to us. */
function receive(awareness: Awareness, clientId: number, state: unknown, clock = 1) {
  const encoder = new Awareness(new Y.Doc());
  void encoder;
  // y-protocols awareness update format: count, then (clientId, clock, JSON state) per entry
  const states = awareness.getStates();
  states.set(clientId, state as Record<string, unknown>);
  (awareness as unknown as { meta: Map<number, { clock: number; lastUpdated: number }> }).meta.set(clientId, { clock, lastUpdated: Date.now() });
  awareness.emit('change', [{ added: [clientId], updated: [], removed: [] }, 'remote']);
}

describe('presence', () => {
  afterEach(() => vi.useRealTimers());

  it('lists other people, not yourself, one entry per person even with two tabs open', () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalState({ user: { id: 'me', name: 'Me', color: '#000' } });
    receive(awareness, 11, { user: { id: 'bob', name: 'Bob', color: 'hsl(10 65% 42%)' } });
    receive(awareness, 12, { user: { id: 'bob', name: 'Bob', color: 'hsl(10 65% 42%)' }, typing: true }); // Bob's second tab
    receive(awareness, 13, { user: { id: 'amy', name: 'Amy', color: '#abc' } });

    const peers = readPeers(awareness);
    expect(peers.map((p) => p.name)).toEqual(['Amy', 'Bob']);
    expect(peers.find((p) => p.userId === 'bob')?.typing).toBe(true); // typing in ANY of his tabs
  });

  it('does not list you for your own other tabs or devices (matched by account, not by tab)', () => {
    const awareness = new Awareness(new Y.Doc());
    receive(awareness, 51, { user: { id: 'me', name: 'Me', color: '#000' } }); // my other tab
    receive(awareness, 52, { user: { id: 'bob', name: 'Bob', color: '#111' } });
    expect(readPeers(awareness, 'me').map((p) => p.name)).toEqual(['Bob']);
    expect(readPeers(awareness).map((p) => p.name)).toEqual(['Bob', 'Me']); // without a self id, nothing is hidden
  });

  it('ignores malformed presence rather than rendering it', () => {
    const awareness = new Awareness(new Y.Doc());
    receive(awareness, 21, {});
    receive(awareness, 22, { user: { name: 'No id' } });
    receive(awareness, 23, { user: { id: 42, name: 'Numeric id' } });
    receive(awareness, 24, null);
    expect(readPeers(awareness)).toEqual([]);
  });

  it('presence store gives React a stable snapshot until something really changes', () => {
    const awareness = new Awareness(new Y.Doc());
    const store = createPresenceStore(awareness);
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    receive(awareness, 31, { user: { id: 'bob', name: 'Bob', color: '#111' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(first);

    const second = store.getSnapshot();
    awareness.emit('change', [{ added: [], updated: [31], removed: [] }, 'remote']); // same content again
    expect(store.getSnapshot()).toBe(second);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('typing is ephemeral: it switches on while editing and off after a pause', () => {
    vi.useFakeTimers();
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalState({ user: { id: 'me', name: 'Me', color: '#000' } });
    const typing = createTypingSignal(awareness, 1000);

    typing.pulse();
    expect(awareness.getLocalState()?.typing).toBe(true);
    vi.advanceTimersByTime(900);
    typing.pulse(); // still typing: the timer restarts
    vi.advanceTimersByTime(900);
    expect(awareness.getLocalState()?.typing).toBe(true);
    vi.advanceTimersByTime(200);
    expect(awareness.getLocalState()?.typing).toBe(false);
  });

  it('presence never lands in the document: the Y.Doc has no trace of it', () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const before = Y.encodeStateAsUpdate(doc);
    awareness.setLocalState({ user: { id: 'me', name: 'Me', color: '#000' }, typing: true });
    receive(awareness, 41, { user: { id: 'bob', name: 'Bob', color: '#111' } });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
