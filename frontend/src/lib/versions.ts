import * as Y from 'yjs';
import { RESTORE_ORIGIN } from '../editor/origins';
import { CONTENT_FIELD } from './documentStore';

/**
 * Restores an earlier version as a NEW, ordinary edit.
 *
 * A CRDT never rewinds: every operation ever made stays in its history (that is what lets
 * offline replicas merge). So "go back" cannot mean "load the old state"; it means "make a new
 * change that turns the current text into the old text". Here that is: delete everything now in
 * the document, then insert copies of the old version's content. The change then travels through
 * the normal sync path, merges with whatever collaborators type, and is itself undoable.
 *
 * Limitation (inherent): text a collaborator types concurrently INTO a paragraph this restore
 * deletes is superseded along with that paragraph. It is not destroyed: the "Before restore"
 * version saved just before keeps it.
 */
export function restoreVersion(ydoc: Y.Doc, versionState: Uint8Array): void {
  const frozen = new Y.Doc();
  try {
    Y.applyUpdate(frozen, versionState);
    const source = frozen.getXmlFragment(CONTENT_FIELD);
    const target = ydoc.getXmlFragment(CONTENT_FIELD);
    ydoc.transact(() => {
      target.delete(0, target.length);
      // clone() copies text, attributes and formatting into new, independent Yjs structures.
      target.insert(0, source.toArray().map((node) => node.clone() as Y.XmlElement | Y.XmlText));
    }, RESTORE_ORIGIN);
  } finally {
    frozen.destroy();
  }
}

/** A throwaway Y.Doc holding a version's content, for a read-only preview. Caller destroys it. */
export function docFromVersion(versionState: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, versionState);
  return doc;
}
