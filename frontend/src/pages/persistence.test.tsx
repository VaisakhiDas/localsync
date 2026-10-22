import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createIndexedDbDocumentStore } from '../lib/idbDocumentStore';
import { renderApp } from '../test/renderApp';

describe('local persistence through the real UI', () => {
  it('keeps typed content after the whole app is torn down and reopened ("reload")', async () => {
    const user = userEvent.setup();

    // --- first page load: create a document and type into it
    const first = renderApp(createIndexedDbDocumentStore({ namespace: 'ui' }));
    await user.click(await screen.findByRole('button', { name: /create your first document/i }));
    const body = await screen.findByRole('textbox', { name: 'Document body' });
    await user.click(body);
    await user.type(body, 'Survives a reload');
    await waitFor(() => expect(body).toHaveTextContent('Survives a reload'));
    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    // MemoryRouter has no URL bar, so read the document's route from its sidebar link.
    const href = screen.getAllByRole('link', { name: 'Untitled document' })[0]!.getAttribute('href')!;
    first.unmount();
    await new Promise((r) => setTimeout(r, 50)); // let the pending IndexedDB writes commit

    // --- second page load: brand-new store and React tree, same browser storage
    renderApp(createIndexedDbDocumentStore({ namespace: 'ui' }), href);
    const restored = await screen.findByRole('textbox', { name: 'Document body' });
    await waitFor(() => expect(restored).toHaveTextContent('Survives a reload'));
  });

  it('keeps a renamed title and the document list after a reload', async () => {
    const user = userEvent.setup();
    const first = renderApp(createIndexedDbDocumentStore({ namespace: 'ui2' }));
    await user.click(await screen.findByRole('button', { name: /create your first document/i }));
    const title = await screen.findByRole('textbox', { name: 'Document title' });
    await user.clear(title);
    await user.type(title, 'Renamed offline{Enter}');
    await waitFor(() => expect(screen.getAllByText('Renamed offline').length).toBeGreaterThan(0));
    first.unmount();

    renderApp(createIndexedDbDocumentStore({ namespace: 'ui2' }));
    expect((await screen.findAllByText('Renamed offline')).length).toBeGreaterThan(0);
  });

  it('shows a storage error instead of an empty editor when IndexedDB is unusable', async () => {
    const broken = {
      open() {
        const req = Object.assign(new EventTarget(), { error: new DOMException('no', 'SecurityError'), onerror: null as null | ((event: never) => void) });
        setTimeout(() => {
          req.onerror?.({ target: req } as never);
          req.dispatchEvent(new Event('error'));
        }, 0);
        return req;
      },
    } as unknown as IDBFactory;
    const real = globalThis.indexedDB;
    globalThis.indexedDB = broken;
    try {
      renderApp(createIndexedDbDocumentStore({ namespace: 'bad' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/storage is unavailable/i);
      expect(screen.queryByRole('textbox', { name: 'Document body' })).not.toBeInTheDocument();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});
