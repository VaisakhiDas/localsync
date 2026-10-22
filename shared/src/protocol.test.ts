import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ackCovers, decodeAck, encodeAck } from './protocol';

const sync = (from: Y.Doc, to: Y.Doc) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
const text = (d: Y.Doc) => d.getText('t');

describe('acknowledgements', () => {
  it('a document is covered by its own acknowledgement', () => {
    const doc = new Y.Doc();
    text(doc).insert(0, 'hello');
    expect(ackCovers(decodeAck(encodeAck(doc)), doc)).toBe(true);
  });

  it('is not covered once the client types something new', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    text(client).insert(0, 'hello');
    sync(client, server);
    const ack = decodeAck(encodeAck(server));
    expect(ackCovers(ack, client)).toBe(true);

    text(client).insert(5, ' world');
    expect(ackCovers(ack, client)).toBe(false);
    sync(client, server);
    expect(ackCovers(decodeAck(encodeAck(server)), client)).toBe(true);
  });

  it('notices a DELETE-ONLY edit, which a state-vector comparison cannot see', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    text(client).insert(0, 'hello world');
    sync(client, server);
    const before = decodeAck(encodeAck(server));
    const svBefore = Y.encodeStateVector(client);

    text(client).delete(5, 6); // remove " world"
    // The state vector did not move at all...
    expect(Y.encodeStateVector(client)).toEqual(svBefore);
    // ...but the acknowledgement correctly says the server has not seen this deletion.
    expect(ackCovers(before, client)).toBe(false);

    sync(client, server);
    expect(ackCovers(decodeAck(encodeAck(server)), client)).toBe(true);
  });

  it('is unaffected by duplicate and out-of-order deliveries', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    const updates: Uint8Array[] = [];
    client.on('update', (u: Uint8Array) => updates.push(u));
    text(client).insert(0, 'a');
    text(client).insert(1, 'b');
    text(client).delete(0, 1);
    for (const u of [...updates].reverse()) Y.applyUpdate(server, u); // out of order
    for (const u of updates) Y.applyUpdate(server, u); // duplicates
    expect(text(server).toString()).toBe('b');
    expect(ackCovers(decodeAck(encodeAck(server)), client)).toBe(true);
  });

  it('an empty server never covers a client that has content', () => {
    const client = new Y.Doc();
    text(client).insert(0, 'offline work');
    expect(ackCovers(decodeAck(encodeAck(new Y.Doc())), client)).toBe(false);
  });
});

describe('replica convergence (CRDT)', () => {
  it('two replicas editing concurrently converge in both directions', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    text(a).insert(0, 'base');
    sync(a, b);

    text(a).insert(4, ' from A');
    text(b).insert(0, 'B: ');
    text(b).delete(3, 2); // concurrently delete "ba"

    sync(a, b);
    sync(b, a);
    expect(text(a).toString()).toBe(text(b).toString());
    expect(text(a).toString()).toContain('from A');
    expect(text(a).toString()).toContain('B: ');
  });

  it('three replicas with random concurrent edits and random sync order always converge', () => {
    // Seeded PRNG so a failure is reproducible.
    let seed = 1234567;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed % n;
    };
    for (let round = 0; round < 25; round++) {
      const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      for (let step = 0; step < 40; step++) {
        const d = docs[rand(3)]!;
        const t = text(d);
        if (t.length > 0 && rand(3) === 0) t.delete(rand(t.length), 1 + rand(Math.min(3, t.length)));
        else t.insert(rand(t.length + 1), String.fromCharCode(97 + rand(26)));
        if (rand(4) === 0) sync(docs[rand(3)]!, docs[rand(3)]!); // partial, random syncing
      }
      for (let pass = 0; pass < 2; pass++) for (const x of docs) for (const y of docs) if (x !== y) sync(x, y);
      const [a, b, c] = docs.map((d) => text(d).toString());
      expect(b).toBe(a);
      expect(c).toBe(a);
    }
  });
});
