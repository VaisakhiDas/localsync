import type { MemberDto } from '@localsync/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { api, ApiError, NetworkError } from '../lib/api';
import type { DocumentMeta } from '../types/document';
import { ShareDialog } from './ShareDialog';

const me = { id: 'alice', email: 'alice@example.com', displayName: 'Alice' };
const auth: AuthContextValue = { state: { status: 'signedIn', user: me }, signIn: vi.fn(), register: vi.fn(), signOut: vi.fn(), sessionExpired: vi.fn() };
const doc = (role: DocumentMeta['role']): DocumentMeta => ({ id: 'doc-1', title: 'Plan', createdAt: 1, updatedAt: 1, role, registered: true });
const members: MemberDto[] = [
  { userId: 'alice', email: 'alice@example.com', displayName: 'Alice', role: 'owner' },
  { userId: 'bob', email: 'bob@example.com', displayName: 'Bob', role: 'editor' },
];

const open = (role: DocumentMeta['role']) =>
  render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ShareDialog doc={doc(role)} onClose={() => undefined} />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe('ShareDialog', () => {
  it('shows everyone with access; the owner and the current user are labelled', async () => {
    vi.spyOn(api, 'listMembers').mockResolvedValue(members);
    open('owner');
    const list = await screen.findByRole('list');
    expect(within(list).getByText('(you)')).toBeInTheDocument();
    expect(within(list).getByText('owner')).toBeInTheDocument();
    expect(within(list).getByLabelText('Role for Bob')).toHaveValue('editor');
  });

  it('lets the owner invite, change a role and remove someone', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listMembers').mockResolvedValue(members);
    const invite = vi.spyOn(api, 'invite').mockResolvedValue([...members, { userId: 'vera', email: 'vera@example.com', displayName: 'Vera', role: 'viewer' }]);
    const change = vi.spyOn(api, 'changeRole').mockResolvedValue(members);
    const remove = vi.spyOn(api, 'removeMember').mockResolvedValue(undefined);
    open('owner');

    await user.type(await screen.findByLabelText('Email address'), 'vera@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(invite).toHaveBeenCalledWith('doc-1', 'vera@example.com', 'viewer');
    expect(await screen.findByText('Vera')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role for Bob'), 'viewer');
    expect(change).toHaveBeenCalledWith('doc-1', 'bob', 'viewer');
    await user.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect(remove).toHaveBeenCalledWith('doc-1', 'bob');
  });

  it('is read-only for non-owners: no invite form, no role pickers, no remove buttons', async () => {
    vi.spyOn(api, 'listMembers').mockResolvedValue(members);
    open('editor');
    await screen.findByText('Bob');
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role for Bob')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the owner can change who has access/)).toBeInTheDocument();
  });

  it('shows the server\'s message when an invite fails (e.g. nobody has that email)', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listMembers').mockResolvedValue(members);
    vi.spyOn(api, 'invite').mockRejectedValue(new ApiError(404, 'not_found', 'No account uses that email address.'));
    open('owner');
    await user.type(await screen.findByLabelText('Email address'), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No account uses that email address.');
  });

  it('explains that sharing needs a connection when offline', async () => {
    vi.spyOn(api, 'listMembers').mockRejectedValue(new NetworkError());
    open('owner');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/needs a connection/i));
  });
});
