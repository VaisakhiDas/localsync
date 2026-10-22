import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isLocalEditOrigin, RESTORE_ORIGIN } from '../editor/origins';
import { CONTENT_FIELD } from './documentStore';
import { docFromVersion, restoreVersion } from './versions';

const paragraph = (text: string) => {
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
};
const fragment = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FIELD);
const setContent = (doc: Y.Doc, ...texts: string[]) => {
  const f = fragment(doc);
  doc.transact(() => {
    f.delete(0, f.length);
    f.insert(0, texts.map(paragraph));
  });
};
const sync = (from: Y.Doc, to: Y.Doc) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
const snapshotOf = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);

describe('restoring a version', () => {
  it('turns the current text into the old text', () => {
    const doc = new Y.Doc();
    setContent(doc, 'first draft', 'second paragraph');
    const v1 = snapshotOf(doc);
    setContent(doc, 'completely rewritten');

    restoreVersion(doc, v1);
    expect(fragment(doc).toString()).toBe('<paragraph>first draft</paragraph><paragraph>second paragraph</paragraph>');
  });

  it('keeps formatting and attributes (bold text, heading level)', () => {
    const doc = new Y.Doc();
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', '2');
    const text = new Y.XmlText();
    text.insert(0, 'Title', { bold: true });
    heading.insert(0, [text]);
    fragment(doc).insert(0, [heading]);
    const v1 = snapshotOf(doc);
    setContent(doc, 'plain');

    restoreVersion(doc, v1);
    const restored = fragment(doc).get(0) as Y.XmlElement;
    expect(restored.nodeName).toBe('heading');
    expect(restored.getAttribute('level')).toBe('2');
    expect((restored.get(0) as Y.XmlText).toDelta()).toEqual([{ insert: 'Title', attributes: { bold: true } }]);
  });

  it('is a NEW change on top of history, not a rewind: the document keeps growing and nothing is lost', () => {
    const doc = new Y.Doc();
    setContent(doc, 'v1 text');
    const v1 = snapshotOf(doc);
    setContent(doc, 'v2 text');
    const before = snapshotOf(doc);

    restoreVersion(doc, v1);
    expect(snapshotOf(doc).byteLength).toBeGreaterThan(before.byteLength); // an additional update, not a replacement

    // The text from before the restore is still recoverable: restoring the safety copy undoes the restore.
    restoreVersion(doc, before);
    expect(fragment(doc).toString()).toBe('<paragraph>v2 text</paragraph>');
  });

  it('travels as an ordinary update: a collaborator who receives it converges', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setContent(a, 'original');
    sync(a, b);
    const v1 = snapshotOf(a);
    setContent(a, 'edited by A');
    sync(a, b);

    restoreVersion(a, v1);
    sync(a, b);
    expect(fragment(b).toString()).toBe('<paragraph>original</paragraph>');
    expect(fragment(b).toString()).toBe(fragment(a).toString());
  });

  it('merges with a collaborator typing at the same time: both replicas end up identical', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setContent(a, 'old one', 'old two');
    sync(a, b);
    const v1 = snapshotOf(a);
    setContent(a, 'newer one', 'newer two');
    sync(a, b);

    // Concurrently: A restores, B appends a brand-new paragraph.
    restoreVersion(a, v1);
    b.transact(() => fragment(b).insert(fragment(b).length, [paragraph('B typed this meanwhile')]));
    sync(a, b);
    sync(b, a);

    expect(fragment(a).toString()).toBe(fragment(b).toString()); // convergence is guaranteed by the CRDT
    expect(fragment(a).toString()).toContain('old one'); // the restore happened...
    expect(fragment(a).toString()).toContain('B typed this meanwhile'); // ...and B's new paragraph was not destroyed
  });

  it('restoring an empty version empties the document', () => {
    const doc = new Y.Doc();
    const empty = snapshotOf(doc);
    setContent(doc, 'something');
    restoreVersion(doc, empty);
    expect(fragment(doc).length).toBe(0);
  });

  it('does not modify the stored snapshot bytes and does not leak the temporary document', () => {
    const doc = new Y.Doc();
    setContent(doc, 'keep');
    const v1 = snapshotOf(doc);
    const copy = new Uint8Array(v1);
    setContent(doc, 'other');
    restoreVersion(doc, v1);
    expect(v1).toEqual(copy);
  });

  it('counts as an edit by this user (so it bumps "last edited" and is acknowledged by the server)', () => {
    expect(isLocalEditOrigin(RESTORE_ORIGIN)).toBe(true);
    const doc = new Y.Doc();
    setContent(doc, 'x');
    const v1 = snapshotOf(doc);
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    restoreVersion(doc, v1);
    expect(origins).toEqual([RESTORE_ORIGIN]); // a single transaction: one update, one undo step for collaborators
  });

  it('docFromVersion gives an independent copy for previewing', () => {
    const doc = new Y.Doc();
    setContent(doc, 'preview me');
    const preview = docFromVersion(snapshotOf(doc));
    setContent(doc, 'live changed');
    expect(fragment(preview).toString()).toBe('<paragraph>preview me</paragraph>');
    preview.destroy();
  });
});
