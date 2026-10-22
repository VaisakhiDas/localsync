import { ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';

/** Origin of a "restore version" update: an intentional edit by this user (see lib/versions.ts). */
export const RESTORE_ORIGIN = Symbol('restore-version');

/**
 * Every Y.Doc update carries an `origin`: whoever caused the transaction.
 *   - ySyncPluginKey      -> the user typed (TipTap/ProseMirror -> Yjs)
 *   - a Y.UndoManager     -> the user pressed undo/redo
 *   - RESTORE_ORIGIN      -> the user restored an earlier version
 *   - the persistence     -> stored updates being replayed from IndexedDB
 *   - the sync provider   -> a remote collaborator's update arriving
 * Only the first two are "this user changed the document".
 */
export const isLocalEditOrigin = (origin: unknown): boolean =>
  origin === ySyncPluginKey || origin instanceof Y.UndoManager || origin === RESTORE_ORIGIN;
