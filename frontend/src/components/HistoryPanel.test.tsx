import type { VersionDto } from '@localsync/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../lib/api';
import { CONTENT_FIELD } from '../lib/documentStore';
import type { DocumentMeta } from '../types/document';
import { HistoryPanel } from './HistoryPanel';

const doc = (role: DocumentMeta['role']): DocumentMeta => ({ id: 'doc-1', title: 'Plan', createdAt: 1, updatedAt: 1, role, registered: true });
const versions: VersionDto[] = [
  { id: 'v2', label: 'Draft two', createdById: 'u1', createdByName: 'Alice', createdAt: '2026-10-22T10:00:00.000Z', sizeBytes: 40 },
  { id: 'v1', label: null, createdById: null, createdByName: null, createdAt: '2026-10-22T09:00:00.000Z', sizeBytes: 30 },
];

function stateWith(text: string): Uint8Array {
  const d = new Y.Doc();
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  d.getXmlFragment(CONTENT_FIELD).insert(0, [p]);
  return Y.encodeStateAsUpdate(d);
}

const open = (role: DocumentMeta['role'], synced: boolean, ydoc = new Y.Doc()) => {
  render(
    <MemoryRouter>
      <HistoryPanel doc={doc(role)} ydoc={ydoc} synced={synced} onClose={() => undefined} />
    </MemoryRouter>,
  );
  return ydoc;
};

describe('HistoryPanel', () => {
  it('lists versions with who saved them, labelling automatic checkpoints as such', async () => {
    vi.spyOn(api, 'listVersions').mockResolvedValue(versions);
    open('owner', true);
    expect(await screen.findByText('Draft two')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText('Automatic checkpoint')).toBeInTheDocument();
  });

  it('only lets you save a version while "Synced", because the server freezes ITS copy', async () => {
    vi.spyOn(api, 'listVersions').mockResolvedValue([]);
    open('editor', false);
    expect(await screen.findByRole('button', { name: 'Save version' })).toBeDisabled();
    expect(screen.getByText(/Wait for .Synced./)).toBeInTheDocument();
  });

  it('saves a named version', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listVersions').mockResolvedValue([]);
    const save = vi.spyOn(api, 'saveVersion').mockResolvedValue(versions[0]!);
    open('owner', true);
    await user.type(await screen.findByLabelText('Save the current version'), 'Before the big rewrite');
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(save).toHaveBeenCalledWith('doc-1', 'Before the big rewrite');
    expect(await screen.findByRole('status')).toHaveTextContent('Version saved.');
  });

  it('viewers can browse history but cannot save or restore', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listVersions').mockResolvedValue(versions);
    vi.spyOn(api, 'versionState').mockResolvedValue(stateWith('old text'));
    open('viewer', true);
    expect(await screen.findByText('Draft two')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save version' })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Preview/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('version-preview')).toHaveTextContent('old text'));
    expect(within(dialog).queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
  });

  it('restoring saves a safety copy FIRST, then applies the old text as a new edit', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listVersions').mockResolvedValue(versions);
    vi.spyOn(api, 'versionState').mockResolvedValue(stateWith('restored text'));
    const ydoc = new Y.Doc();
    const calls: string[] = [];
    const save = vi.spyOn(api, 'saveVersion').mockImplementation(async (_id, label) => {
      // At the moment the safety copy is requested, the live document must still be untouched.
      calls.push(`save:${ydoc.getXmlFragment(CONTENT_FIELD).toString() === '' ? 'doc-untouched' : 'doc-already-changed'}:${label}`);
      return versions[0]!;
    });
    open('editor', true, ydoc);

    await user.click((await screen.findAllByRole('button', { name: /^Preview Draft two/ }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('version-preview')).toHaveTextContent('restored text'));
    await user.click(within(dialog).getByRole('button', { name: 'Restore this version' }));

    await waitFor(() => expect(ydoc.getXmlFragment(CONTENT_FIELD).toString()).toBe('<paragraph>restored text</paragraph>'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['save:doc-untouched:Before restoring “Draft two”']);
    expect(await screen.findByText(/saved in this history, so you can go back/i)).toBeInTheDocument();
  });

  it('will not restore until the connection is fully synchronised', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listVersions').mockResolvedValue(versions);
    vi.spyOn(api, 'versionState').mockResolvedValue(stateWith('x'));
    open('owner', false);
    await user.click((await screen.findAllByRole('button', { name: /^Preview/ }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Restore this version' })).toBeDisabled();
    expect(within(dialog).getByText(/needs a live connection/i)).toBeInTheDocument();
  });

  it('shows a clear message when offline', async () => {
    const { NetworkError } = await import('../lib/api');
    vi.spyOn(api, 'listVersions').mockRejectedValue(new NetworkError());
    open('owner', true);
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs a connection/i);
  });
});
