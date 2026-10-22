import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DocumentStore } from '../lib/documentStore';
import { createMemoryDocumentStore } from '../lib/memoryDocumentStore';
import { renderApp } from '../test/renderApp';
import type { DocumentMeta } from '../types/document';

const doc = (over: Partial<DocumentMeta>): DocumentMeta => ({
  id: crypto.randomUUID(),
  title: 'Doc',
  createdAt: 1,
  updatedAt: 1,
  role: 'owner',
  ...over,
});

describe('dashboard', () => {
  it('shows a loading state, then an empty state with a call to action', async () => {
    renderApp(createMemoryDocumentStore());
    expect(screen.getAllByText(/loading documents/i).length).toBeGreaterThan(0);
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create your first document/i })).toBeInTheDocument();
  });

  it('creates a document and opens it in the editor', async () => {
    const user = userEvent.setup();
    renderApp(createMemoryDocumentStore());
    await user.click(await screen.findByRole('button', { name: /create your first document/i }));
    expect(await screen.findByRole('textbox', { name: 'Document title' })).toHaveValue('Untitled document');
    expect(await screen.findByRole('textbox', { name: 'Document body' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('renames a document from the list', async () => {
    const user = userEvent.setup();
    renderApp(createMemoryDocumentStore([doc({ title: 'Draft' })]));
    await user.click(await screen.findByRole('button', { name: 'Rename Draft' }));
    const input = await screen.findByLabelText('Title');
    await user.clear(input);
    await user.type(input, 'Final report');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Final report' })).toBeInTheDocument());
  });

  it('asks for confirmation before deleting, and deleting restores the empty state', async () => {
    const user = userEvent.setup();
    renderApp(createMemoryDocumentStore([doc({ title: 'Throwaway' })]));
    await user.click(await screen.findByRole('button', { name: 'Delete Throwaway' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/permanently deleted/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete Throwaway' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Throwaway' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
  });

  it('offers "Leave" (never "Delete") for a document shared with you, and viewers cannot rename', async () => {
    const user = userEvent.setup();
    const store = createMemoryDocumentStore([doc({ id: 'shared-doc', title: 'Shared', role: 'viewer', ownerName: 'Alice', registered: true })]);
    renderApp(store);
    expect(await screen.findByRole('button', { name: 'Rename Shared' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete Shared' })).not.toBeInTheDocument();
    expect(screen.getByText(/Shared by Alice/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Leave Shared' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/owner.s copy is not affected/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
  });

  it('shows a revoked copy as read-only with a "Remove" action (not Rename / Leave / Delete)', async () => {
    const user = userEvent.setup();
    const store = createMemoryDocumentStore([doc({ id: 'gone-doc', title: 'Was shared', role: 'editor', ownerName: 'Alice', registered: true, revoked: true })]);
    renderApp(store);
    expect(await screen.findByText(/No longer shared/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename Was shared' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Leave Was shared' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Was shared from this device' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nothing on the server changes/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove copy' }));
    expect(await screen.findByRole('heading', { name: 'No documents yet' })).toBeInTheDocument();
  });

  it('shows a retryable error when the list cannot be loaded', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const base = createMemoryDocumentStore([doc({ title: 'Recovered' })]);
    const flaky: DocumentStore = {
      ...base,
      async list() {
        if (calls++ === 0) throw new Error('Storage is unavailable.');
        return base.list();
      },
    };
    renderApp(flaky);
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Rename Recovered' })).toBeInTheDocument();
  });

  it('shows "Document not found" for an unknown id', async () => {
    renderApp(createMemoryDocumentStore(), '/d/00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText('Document not found')).toBeInTheDocument();
  });
});
