import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  SquareCode,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface ToolbarProps {
  editor: Editor | null;
  /** True for read-only viewers: every control is disabled. */
  disabled: boolean;
  onLinkClick: () => void;
}

function ToolButton({
  label,
  shortcut,
  active = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor selection: a mousedown on a button would otherwise blur the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-9 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:text-zinc-300 ${
        active ? 'bg-brand-100 text-brand-700' : 'text-zinc-700 hover:bg-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px bg-zinc-200" aria-hidden="true" />;

const mod = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

const INACTIVE = {
  h1: false,
  h2: false,
  h3: false,
  bold: false,
  italic: false,
  link: false,
  bullet: false,
  ordered: false,
  quote: false,
  code: false,
  canUndo: false,
  canRedo: false,
};

export function Toolbar({ editor, disabled, onLinkClick }: ToolbarProps) {
  // TipTap v3 does not re-render React on every transaction; subscribe to just what the toolbar shows.
  const state =
    useEditorState({
      editor,
      selector: ({ editor: e }) =>
        e
          ? {
              h1: e.isActive('heading', { level: 1 }),
              h2: e.isActive('heading', { level: 2 }),
              h3: e.isActive('heading', { level: 3 }),
              bold: e.isActive('bold'),
              italic: e.isActive('italic'),
              link: e.isActive('link'),
              bullet: e.isActive('bulletList'),
              ordered: e.isActive('orderedList'),
              quote: e.isActive('blockquote'),
              code: e.isActive('codeBlock'),
              canUndo: e.can().undo(),
              canRedo: e.can().redo(),
            }
          : INACTIVE,
    }) ?? INACTIVE;

  const off = disabled || !editor;
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-white px-2 py-1.5"
    >
      <ToolButton label="Undo" shortcut={`${mod}Z`} disabled={off || !state.canUndo} onClick={run((e) => e.chain().focus().undo().run())}>
        <Undo2 className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Redo" shortcut={`${mod}⇧Z`} disabled={off || !state.canRedo} onClick={run((e) => e.chain().focus().redo().run())}>
        <Redo2 className="size-4" aria-hidden="true" />
      </ToolButton>
      <Divider />
      <ToolButton label="Heading 1" active={state.h1} disabled={off} onClick={run((e) => e.chain().focus().toggleHeading({ level: 1 }).run())}>
        <Heading1 className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Heading 2" active={state.h2} disabled={off} onClick={run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}>
        <Heading2 className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Heading 3" active={state.h3} disabled={off} onClick={run((e) => e.chain().focus().toggleHeading({ level: 3 }).run())}>
        <Heading3 className="size-4" aria-hidden="true" />
      </ToolButton>
      <Divider />
      <ToolButton label="Bold" shortcut={`${mod}B`} active={state.bold} disabled={off} onClick={run((e) => e.chain().focus().toggleBold().run())}>
        <Bold className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Italic" shortcut={`${mod}I`} active={state.italic} disabled={off} onClick={run((e) => e.chain().focus().toggleItalic().run())}>
        <Italic className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Link" shortcut={`${mod}K`} active={state.link} disabled={off} onClick={onLinkClick}>
        <LinkIcon className="size-4" aria-hidden="true" />
      </ToolButton>
      <Divider />
      <ToolButton label="Bulleted list" active={state.bullet} disabled={off} onClick={run((e) => e.chain().focus().toggleBulletList().run())}>
        <List className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Numbered list" active={state.ordered} disabled={off} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}>
        <ListOrdered className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Blockquote" active={state.quote} disabled={off} onClick={run((e) => e.chain().focus().toggleBlockquote().run())}>
        <Quote className="size-4" aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Code block" active={state.code} disabled={off} onClick={run((e) => e.chain().focus().toggleCodeBlock().run())}>
        <SquareCode className="size-4" aria-hidden="true" />
      </ToolButton>
    </div>
  );
}
