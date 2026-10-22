import type { Editor, Extensions } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { LinkDialog } from './LinkDialog';
import { Toolbar } from './Toolbar';

interface RichTextEditorProps {
  /** Must be referentially stable (useMemo): a new array re-creates the editor. */
  extensions: Extensions;
  editable: boolean;
  /** Gives the page access to the editor instance (e.g. for tests / status UI). */
  onEditorReady?: (editor: Editor | null) => void;
}

export function RichTextEditor({ extensions, editable, onEditorReady }: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);

  const editor = useEditor(
    {
      extensions,
      editable,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Document body',
        },
      },
    },
    [extensions],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  const openLinkDialog = () => {
    if (editable && editor) setLinkOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLinkDialog();
    }
  };

  // Links are inert while editing (clicking places the caret); read-only viewers can follow them.
  const onClick = (e: MouseEvent) => {
    if (editable) return;
    const anchor = (e.target as HTMLElement).closest('a[href]');
    if (anchor) {
      e.preventDefault();
      window.open(anchor.getAttribute('href') ?? '', '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="shrink-0">
        <Toolbar editor={editor} disabled={!editable} onLinkClick={openLinkDialog} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-8">
        <div
          className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white px-5 py-6 shadow-sm sm:px-12 sm:py-10"
          onClick={onClick}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      {linkOpen && editor && (
        <LinkDialog
          initialUrl={(editor.getAttributes('link').href as string | undefined) ?? ''}
          onClose={() => {
            setLinkOpen(false);
            editor.commands.focus();
          }}
          onApply={(href) => {
            if (editor.isActive('link') || !editor.state.selection.empty) {
              editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            } else {
              // Nothing selected: insert the address itself as the link text.
              editor
                .chain()
                .focus()
                .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
                .run();
            }
          }}
          onRemove={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
        />
      )}
    </div>
  );
}
