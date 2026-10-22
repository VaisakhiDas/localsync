import type { CommentDto } from '@localsync/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { api } from '../lib/api';
import type { DocumentMeta } from '../types/document';
import { CommentsPanel } from './CommentsPanel';

const me = { id: 'bob', email: 'bob@example.com', displayName: 'Bob' };
const auth: AuthContextValue = { state: { status: 'signedIn', user: me }, signIn: vi.fn(), register: vi.fn(), signOut: vi.fn(), sessionExpired: vi.fn() };
const doc = (role: DocumentMeta['role']): DocumentMeta => ({ id: 'doc-1', title: 'Plan', createdAt: 1, updatedAt: 1, role, registered: true });
const comment = (over: Partial<CommentDto>): CommentDto => ({
  id: 'c1', authorId: 'alice', authorName: 'Alice', body: 'Please check this', quote: null, resolved: false, createdAt: new Date().toISOString(), ...over,
});

const open = (role: DocumentMeta['role'], selection = '') =>
  render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <CommentsPanel doc={doc(role)} getSelectionText={() => selection} onClose={() => undefined} />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe('CommentsPanel', () => {
  it('shows comments with their quoted text and resolved state', async () => {
    vi.spyOn(api, 'listComments').mockResolvedValue([comment({ quote: 'the quoted sentence' }), comment({ id: 'c2', body: 'Fixed it', resolved: true })]);
    open('editor');
    expect(await screen.findByText('Please check this')).toBeInTheDocument();
    expect(screen.getByText(/the quoted sentence/)).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('posts a comment with the selected text attached as a quote', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listComments').mockResolvedValue([]);
    const add = vi.spyOn(api, 'addComment').mockResolvedValue(comment({}));
    open('editor', 'selected words');
    await user.click(await screen.findByRole('button', { name: 'Quote selection' }));
    expect(screen.getByText(/selected words/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Write a comment'), 'Looks off');
    await user.click(screen.getByRole('button', { name: 'Comment' }));
    expect(add).toHaveBeenCalledWith('doc-1', 'Looks off', 'selected words');
  });

  it('viewers can read but not write or resolve', async () => {
    vi.spyOn(api, 'listComments').mockResolvedValue([comment({})]);
    open('viewer');
    expect(await screen.findByText('Please check this')).toBeInTheDocument();
    expect(screen.queryByLabelText('Write a comment')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(screen.getByText(/only editors and the owner can write them/i)).toBeInTheDocument();
  });

  it('offers Delete only on your own comments (editors) or on everything (owner)', async () => {
    vi.spyOn(api, 'listComments').mockResolvedValue([comment({ id: 'a', authorId: 'alice' }), comment({ id: 'b', authorId: 'bob', authorName: 'Bob', body: 'mine' })]);
    const { unmount } = open('editor');
    await screen.findByText('mine');
    expect(screen.queryByRole('button', { name: 'Delete comment by Alice' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete comment by Bob' })).toBeInTheDocument();
    unmount();

    open('owner');
    await screen.findByText('mine');
    expect(screen.getByRole('button', { name: 'Delete comment by Alice' })).toBeInTheDocument();
  });

  it('resolves and deletes', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listComments').mockResolvedValue([comment({ authorId: 'bob', authorName: 'Bob' })]);
    const resolve = vi.spyOn(api, 'resolveComment').mockResolvedValue(comment({ resolved: true }));
    const del = vi.spyOn(api, 'deleteComment').mockResolvedValue(undefined);
    open('editor');
    const item = (await screen.findByText('Please check this')).closest('li')!;
    await user.click(within(item).getByRole('button', { name: 'Resolve' }));
    expect(resolve).toHaveBeenCalledWith('doc-1', 'c1', true);
    await user.click(within(item).getByRole('button', { name: /Delete comment/ }));
    expect(del).toHaveBeenCalledWith('doc-1', 'c1');
  });
});
