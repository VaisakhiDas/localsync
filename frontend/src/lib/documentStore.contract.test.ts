import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE } from '@localsync/shared';
import type { DocumentStore } from './documentStore';
import { createIndexedDbDocumentStore } from './idbDocumentStore';
import { createMemoryDocumentStore } from './memoryDocumentStore';

// The same behaviour must hold for every DocumentStore implementation.
describe.each<[string, () => DocumentStore]>([
  ['memory store', () => createMemoryDocumentStore()],
  ['IndexedDB store', () => createIndexedDbDocumentStore({ namespace: 'contract' })],
])('DocumentStore contract: %s', (_name, make) => {
  it('creates documents with a unique UUID, default title and owner role', async () => {
    const store = make();
    const a = await store.create();
    const b = await store.create();
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe(DEFAULT_TITLE);
    expect(a.role).toBe('owner');
    expect(await store.list()).toHaveLength(2);
    expect(await store.get(a.id)).toEqual(a);
  });

  it('renames with normalisation and falls back to the default for blank titles', async () => {
    const store = make();
    const doc = await store.create();
    expect((await store.rename(doc.id, '  Meeting   notes  ')).title).toBe('Meeting notes');
    expect((await store.rename(doc.id, '   ')).title).toBe(DEFAULT_TITLE);
  });

  it('lists the most recently touched document first', async () => {
    const store = make();
    const first = await store.create();
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.create();
    expect((await store.list()).map((d) => d.id)).toEqual([second.id, first.id]);
    await new Promise((r) => setTimeout(r, 5));
    await store.touch(first.id);
    expect((await store.list()).map((d) => d.id)).toEqual([first.id, second.id]);
  });

  it('removes documents and rejects operations on unknown ids', async () => {
    const store = make();
    const doc = await store.create();
    await store.remove(doc.id);
    expect(await store.get(doc.id)).toBeUndefined();
    expect(await store.touch(doc.id)).toBeUndefined();
    await expect(store.rename(doc.id, 'x')).rejects.toThrow(/not found/i);
    await expect(store.remove(doc.id)).rejects.toThrow(/not found/i);
  });
});
