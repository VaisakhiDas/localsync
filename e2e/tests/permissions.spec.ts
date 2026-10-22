import { expect, test, type Page } from '@playwright/test';
import { bodyText, createDocument, editor, expectPhase, newDevice, openSharedDocument, registerPerson, shareWith, signInOnNewDevice, syncNow, typeInEditor } from '../helpers';

/** What the WebSocket server answers when asked for a document (as a real browser session would ask). */
const probeSocket = (page: Page, docId: string) =>
  page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/collab/${id}`);
        ws.onclose = (event) => resolve(event.code);
        setTimeout(() => resolve(-1), 8000);
      }),
    docId,
  );

test.describe('permissions, end to end', () => {
  test('a viewer can read live updates but cannot edit: the UI is read-only AND the server refuses tampering', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const vera = await registerPerson(browser, 'Vera');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Owner text. ');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, vera.email, 'Viewer');
    await openSharedDocument(vera.page, docId);
    await expect(editor(vera.page)).toContainText('Owner text.');
    await expectPhase(vera.page, 'synced');

    // UI: read-only, toolbar disabled, explanation shown.
    await expect(vera.page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await expect(vera.page.getByRole('button', { name: 'Bold' })).toBeDisabled();
    await expect(vera.page.getByText(/view-only access/)).toBeVisible();
    await vera.page.getByRole('button', { name: 'Share' }).click();
    await expect(vera.page.getByRole('dialog').getByLabel('Email address')).toHaveCount(0); // viewers cannot invite
    await vera.page.getByRole('button', { name: 'Done' }).click();

    // Live reading still works.
    await typeInEditor(alice.page, 'Live update. ');
    await expect(editor(vera.page)).toContainText('Live update.');

    // A hostile client: force the editor editable and type anyway.
    await vera.page.evaluate(() => document.querySelector('.ProseMirror')!.setAttribute('contenteditable', 'true'));
    await editor(vera.page).click();
    await vera.page.keyboard.type('VERA-TAMPERING');
    await vera.page.waitForTimeout(1500);
    await expect(alice.page.locator('.ProseMirror')).not.toContainText('VERA-TAMPERING'); // never relayed

    // And not stored: a fresh device for the owner sees no trace of it.
    const fresh = await signInOnNewDevice(browser, alice);
    await openSharedDocument(fresh.page, docId);
    await expect(editor(fresh.page)).toContainText('Live update.');
    expect(await bodyText(fresh.page)).not.toContain('VERA-TAMPERING');
    for (const p of [alice, vera, fresh]) await p.context.close();
  });

  test('a signed-in stranger cannot reach a private document: not listed, not openable, WebSocket refused (4403)', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const sam = await registerPerson(browser, 'Sam');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Top secret. ');
    await expectPhase(alice.page, 'synced');

    await syncNow(sam.page);
    await sam.page.goto('/');
    await expect(sam.page.locator(`a[href="/d/${docId}"]`)).toHaveCount(0);
    await sam.page.goto(`/d/${docId}`); // guessing the id
    await expect(sam.page.getByText('Document not found')).toBeVisible();

    expect(await probeSocket(sam.page, docId)).toBe(4403); // permanent "forbidden", with no content
    const api = await sam.page.evaluate(async (id) => (await fetch(`/api/documents/${id}`)).status, docId);
    expect(api).toBe(404); // same answer as "does not exist"
    await alice.context.close();
    await sam.context.close();
  });

  test('without a session the WebSocket is refused (4401) and the app sends visitors to sign in', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'private');
    await expectPhase(alice.page, 'synced');

    const anonymous = await newDevice(browser);
    await anonymous.page.goto('/login');
    expect(await probeSocket(anonymous.page, docId)).toBe(4401);
    await anonymous.page.goto(`/d/${docId}`);
    await expect(anonymous.page).toHaveURL(/\/login$/);
    await alice.context.close();
    await anonymous.context.close();
  });

  test('removing a collaborator cuts off their open editor but KEEPS a read-only copy, which they can then remove deliberately', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Shared for now. ');
    await shareWith(alice.page, bob.email, 'Editor');
    await openSharedDocument(bob.page, docId);
    await expectPhase(bob.page, 'synced');

    await alice.page.getByRole('button', { name: 'Share' }).click();
    await alice.page.getByRole('button', { name: 'Remove Bob' }).click();
    await expect(alice.page.getByRole('dialog').getByText(bob.email)).toHaveCount(0);

    // His open editor is cut off at once and becomes a clearly labelled, read-only copy: nothing is discarded.
    await expectPhase(bob.page, 'revoked', 30_000);
    await expect(bob.page.getByText(/You no longer have access to this document/)).toBeVisible();
    await expect(bob.page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await expect(editor(bob.page)).toContainText('Shared for now.');
    expect(await probeSocket(bob.page, docId)).toBe(4403); // the server refuses him for real

    // He can remove the copy himself, from the dashboard.
    await bob.page.goto('/');
    await expect(bob.page.getByText(/No longer shared/)).toBeVisible();
    await bob.page.getByRole('button', { name: /^Remove .* from this device$/ }).click();
    await bob.page.getByRole('dialog').getByRole('button', { name: 'Remove copy' }).click();
    await expect(bob.page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
    await alice.context.close();
    await bob.context.close();
  });

  test('demoting an editor to viewer makes their open editor read-only without a reload', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Hello. ');
    await shareWith(alice.page, bob.email, 'Editor');
    await openSharedDocument(bob.page, docId);
    await expectPhase(bob.page, 'synced');
    await expect(bob.page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');

    await alice.page.getByRole('button', { name: 'Share' }).click();
    await alice.page.getByLabel('Role for Bob').selectOption('viewer');
    await alice.page.getByRole('button', { name: 'Done' }).click();

    await expect(bob.page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false', { timeout: 30_000 });
    await expect(bob.page.getByText(/view-only access|read-only/)).toBeVisible();
    await alice.context.close();
    await bob.context.close();
  });

  test('promoting a viewer to editor makes their open editor writable without a reload, and their edits then sync', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const vera = await registerPerson(browser, 'Vera');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Owner text. ');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, vera.email, 'Viewer');
    await openSharedDocument(vera.page, docId);
    await expectPhase(vera.page, 'synced');
    await expect(vera.page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

    await alice.page.getByRole('button', { name: 'Share' }).click();
    await alice.page.getByLabel('Role for Vera').selectOption('editor');
    await alice.page.getByRole('button', { name: 'Done' }).click();

    await expect(vera.page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 });
    await typeInEditor(vera.page, 'Vera can write now. ');
    await expect(alice.page.locator('.ProseMirror')).toContainText('Vera can write now.', { timeout: 20_000 });
    await alice.context.close();
    await vera.context.close();
  });
});
