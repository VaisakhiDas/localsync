import type { Extensions } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';

export interface ExtensionOptions {
  /**
   * ProseMirror's own undo history. It MUST be off whenever the Yjs
   * Collaboration extension is present: that extension supplies a Yjs-aware
   * undo manager, and two history stacks would fight over the same document.
   */
  history: boolean;
  /** Extra extensions (Collaboration, CollaborationCaret, ...). */
  extra?: Extensions;
  placeholder?: string;
}

export function createEditorExtensions({ history, extra = [], placeholder = 'Start writing…' }: ExtensionOptions): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      undoRedo: history ? {} : false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    Placeholder.configure({ placeholder }),
    ...extra,
  ];
}
