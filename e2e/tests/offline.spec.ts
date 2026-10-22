import { expect, test } from '@playwright/test';
import {
  bodyText,
  createDocument,
  editor,
  expectPhase,
  goOffline,
  goOnline,
  openSharedDocument,
  registerPerson,
  shareWith,
  signInOnNewDevice,
  syncChip,
  typeInEditor,
} from '../helpers';

/** The offline demo script, automated. */
test.describe('offline-first behaviour', () => {
  test('disconnect one client, edit offline, edit on the other, reconnect: both converge and the server has everything', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Start. ');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, bob.email, 'Editor');
    await openSharedDocument(bob.page, docId);
    await expect(editor(bob.page)).toContainText('Start.');
    await expectPhase(bob.page, 'synced');

    // Bob loses the network.
    await goOffline(bob.context, bob.page);
    await expect(bob.page.getByText(/You’re offline/)).toBeVisible();
    await typeInEditor(bob.page, 'BOB-OFFLINE-EDIT ');
    await expect(editor(bob.page)).toContainText('BOB-OFFLINE-EDIT'); // the editor stays fully usable
    await expectPhase(bob.page, 'offline'); // and never claims to be synced

    // Alice keeps working; Bob's offline text has NOT reached her.
    await typeInEditor(alice.page, 'ALICE-ONLINE-EDIT ');
    await expectPhase(alice.page, 'synced');
    await expect(editor(alice.page)).not.toContainText('BOB-OFFLINE-EDIT');

    // Bob reconnects: the Yjs handshake exchanges exactly what each side is missing.
    await goOnline(bob.context);
    await expect(editor(alice.page)).toContainText('BOB-OFFLINE-EDIT', { timeout: 20_000 });
    await expect(editor(bob.page)).toContainText('ALICE-ONLINE-EDIT', { timeout: 20_000 });
    await expectPhase(bob.page, 'synced');
    await expectPhase(alice.page, 'synced');
    expect(await bodyText(alice.page)).toBe(await bodyText(bob.page));

    // Persistence: a brand-new device (empty browser storage) gets the merged document from the server.
    const fresh = await signInOnNewDevice(browser, alice);
    await openSharedDocument(fresh.page, docId);
    await expect(editor(fresh.page)).toContainText('BOB-OFFLINE-EDIT');
    await expect(editor(fresh.page)).toContainText('ALICE-ONLINE-EDIT');
    for (const p of [alice, bob, fresh]) await p.context.close();
  });

  test('reload while offline: the app opens from the service worker, the document is still there, and it syncs when the network returns', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    const docId = await createDocument(ada.page);
    await typeInEditor(ada.page, 'Saved while online. ');
    await expectPhase(ada.page, 'synced');

    await goOffline(ada.context, ada.page);
    await typeInEditor(ada.page, 'Typed offline. ');
    await ada.page.reload(); // the page itself must load with no network at all
    await expect(editor(ada.page)).toContainText('Saved while online.');
    await expect(editor(ada.page)).toContainText('Typed offline.'); // restored from IndexedDB
    await expectPhase(ada.page, 'offline');
    await expect(ada.page.getByText('Saved on this device', { exact: true })).toBeVisible();

    await typeInEditor(ada.page, 'More after the reload. ');
    await goOnline(ada.context);
    await expectPhase(ada.page, 'synced');

    const fresh = await signInOnNewDevice(browser, ada);
    await openSharedDocument(fresh.page, docId);
    for (const text of ['Saved while online.', 'Typed offline.', 'More after the reload.']) await expect(editor(fresh.page)).toContainText(text);
    await ada.context.close();
    await fresh.context.close();
  });

  test('a document created while offline works immediately, says it is not uploaded yet, and uploads by itself when the network returns', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    await ada.context.setOffline(true); // no document is open yet: just cut the network
    await ada.page.getByRole('button', { name: 'New document' }).first().click();
    await expect(editor(ada.page)).toBeVisible();
    const docId = ada.page.url().split('/d/')[1]!;
    await typeInEditor(ada.page, 'Born offline. ');
    await expect(syncChip(ada.page)).toHaveAttribute('data-sync-phase', 'local');
    await expect(ada.page.getByText('Not uploaded yet')).toBeVisible();
    await expect(ada.page.getByRole('button', { name: 'Share' })).toBeDisabled(); // sharing needs the server to know the document

    await ada.page.reload(); // still offline: nothing is lost
    await expect(editor(ada.page)).toContainText('Born offline.');

    await goOnline(ada.context);
    await expectPhase(ada.page, 'synced', 30_000); // uploaded, then synchronised
    await expect(ada.page.getByRole('button', { name: 'Share' })).toBeEnabled();

    const fresh = await signInOnNewDevice(browser, ada);
    await openSharedDocument(fresh.page, docId);
    await expect(editor(fresh.page)).toContainText('Born offline.');
    await ada.context.close();
    await fresh.context.close();
  });

  test('repeated network loss: three cycles of offline edits on both sides never lose or duplicate anything', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await shareWith(alice.page, bob.email, 'Editor');
    await typeInEditor(alice.page, 'base ');
    await openSharedDocument(bob.page, docId);
    await expect(editor(bob.page)).toContainText('base');
    await expectPhase(bob.page, 'synced');

    for (let round = 1; round <= 3; round++) {
      await goOffline(bob.context, bob.page);
      await typeInEditor(bob.page, `[bob${round}] `);
      await typeInEditor(alice.page, `[alice${round}] `);
      await goOnline(bob.context);
      await expectPhase(bob.page, 'synced');
      await expect(editor(alice.page)).toContainText(`[bob${round}]`, { timeout: 20_000 });
      await expect(editor(bob.page)).toContainText(`[alice${round}]`, { timeout: 20_000 });
    }
    await expectPhase(alice.page, 'synced');
    const [a, b] = [await bodyText(alice.page), await bodyText(bob.page)];
    expect(a).toBe(b);
    for (let round = 1; round <= 3; round++) {
      expect(a.split(`[bob${round}]`).length - 1).toBe(1); // exactly once: no duplicates from re-sent updates
      expect(a.split(`[alice${round}]`).length - 1).toBe(1);
    }
    await alice.context.close();
    await bob.context.close();
  });

  test('a rename made while offline reaches the server and other devices later', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    const docId = await createDocument(ada.page);
    await typeInEditor(ada.page, 'x');
    await expectPhase(ada.page, 'synced');
    await goOffline(ada.context, ada.page);

    await ada.page.getByRole('textbox', { name: 'Document title' }).fill('Renamed offline');
    await ada.page.keyboard.press('Enter');
    await goOnline(ada.context);

    const fresh = await signInOnNewDevice(browser, ada);
    await expect(fresh.page.locator(`a[href="/d/${docId}"]`).first()).toContainText('Renamed offline', { timeout: 30_000 });
    await ada.context.close();
    await fresh.context.close();
  });
});
