import type { Editor } from '@tiptap/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createEditorExtensions } from './extensions';
import { RichTextEditor } from './RichTextEditor';

const extensions = createEditorExtensions({ history: true });

async function setup(editable = true) {
  let editor: Editor | null = null;
  render(<RichTextEditor extensions={extensions} editable={editable} onEditorReady={(e) => (editor = e)} />);
  await waitFor(() => expect(editor).not.toBeNull());
  return () => editor!;
}

describe('RichTextEditor', () => {
  it('initialises an empty, editable document with an accessible textbox', async () => {
    const getEditor = await setup();
    expect(screen.getByRole('textbox', { name: 'Document body' })).toBeInTheDocument();
    expect(getEditor().isEmpty).toBe(true);
    expect(getEditor().isEditable).toBe(true);
  });

  it.each([
    ['Bold', '<strong>hello</strong>'],
    ['Italic', '<em>hello</em>'],
    ['Heading 2', '<h2>hello</h2>'],
    ['Bulleted list', '<ul><li><p>hello</p></li></ul>'],
    ['Numbered list', '<ol><li><p>hello</p></li></ol>'],
    ['Blockquote', '<blockquote><p>hello</p></blockquote>'],
  ])('the %s button formats the selection', async (label, expected) => {
    const user = userEvent.setup();
    const getEditor = await setup();
    act(() => {
      getEditor().commands.setContent('<p>hello</p>');
      getEditor().commands.setTextSelection({ from: 1, to: 6 });
    });
    await user.click(screen.getByRole('button', { name: label }));
    expect(getEditor().getHTML()).toContain(expected);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  });

  it('inserts a code block', async () => {
    const user = userEvent.setup();
    const getEditor = await setup();
    act(() => {
      getEditor().commands.setContent('<p>x = 1</p>');
      getEditor().commands.setTextSelection({ from: 1, to: 6 });
    });
    await user.click(screen.getByRole('button', { name: 'Code block' }));
    expect(getEditor().getHTML()).toContain('<pre><code>x = 1</code></pre>');
  });

  it('applies a link through the dialog and rejects javascript: URLs', async () => {
    const user = userEvent.setup();
    const getEditor = await setup();
    act(() => {
      getEditor().commands.setContent('<p>site</p>');
      getEditor().commands.setTextSelection({ from: 1, to: 5 });
    });
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(await screen.findByLabelText('Address'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid web address/i);
    expect(getEditor().getHTML()).not.toContain('javascript:');

    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(getEditor().getHTML()).toContain('href="https://example.com/"');
  });

  it('undo reverts the last formatting change', async () => {
    const user = userEvent.setup();
    const getEditor = await setup();
    act(() => {
      getEditor().commands.setContent('<p>hello</p>');
      getEditor().commands.setTextSelection({ from: 1, to: 6 });
      getEditor().commands.toggleBold();
    });
    expect(getEditor().getHTML()).toContain('<strong>');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(getEditor().getHTML()).not.toContain('<strong>');
  });

  it('is read-only with a disabled toolbar when editable is false', async () => {
    const getEditor = await setup(false);
    expect(getEditor().isEditable).toBe(false);
    for (const name of ['Bold', 'Italic', 'Link', 'Heading 1', 'Undo']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});
