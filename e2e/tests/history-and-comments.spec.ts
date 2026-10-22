import { expect, test } from '@playwright/test';
import { bodyText, createDocument, editor, expectPhase, openSharedDocument, registerPerson, shareWith, typeInEditor } from '../helpers';

test.describe('version history', () => {
  test('save, edit on, restore: the collaborator sees it live, and the restore itself can be undone from history', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'VERSION-ONE-TEXT');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, bob.email, 'Editor');
    await openSharedDocument(bob.page, docId);
    await expect(editor(bob.page)).toContainText('VERSION-ONE-TEXT');

    // Save a named version, then keep writing.
    await alice.page.getByRole('button', { name: 'History' }).click();
    const history = alice.page.getByRole('complementary', { name: 'Version history' });
    await history.getByLabel('Save the current version').fill('Draft one');
    await history.getByRole('button', { name: 'Save version' }).click();
    await expect(history.getByText('Draft one')).toBeVisible();

    await typeInEditor(alice.page, ' PLUS-LATER-WORK');
    await expectPhase(alice.page, 'synced');
    await expect(editor(bob.page)).toContainText('PLUS-LATER-WORK');

    // Preview shows the OLD text only; the live document is untouched by looking.
    await history.getByRole('button', { name: /^Preview Draft one/ }).click();
    const preview = alice.page.getByRole('dialog');
    await expect(preview.getByTestId('version-preview')).toContainText('VERSION-ONE-TEXT');
    await expect(preview.getByTestId('version-preview')).not.toContainText('PLUS-LATER-WORK');
    await expect(editor(alice.page)).toContainText('PLUS-LATER-WORK');

    // Restore: a new edit that both collaborators receive.
    await preview.getByRole('button', { name: 'Restore this version' }).click();
    await expect(alice.page.getByText(/saved in this history, so you can go back/)).toBeVisible();
    await expect(editor(alice.page)).not.toContainText('PLUS-LATER-WORK');
    await expect(editor(bob.page)).not.toContainText('PLUS-LATER-WORK', { timeout: 20_000 });
    await expect(editor(bob.page)).toContainText('VERSION-ONE-TEXT');
    await expectPhase(alice.page, 'synced');
    expect(await bodyText(alice.page)).toBe(await bodyText(bob.page));

    // The safety copy exists, attributed to Alice, and restoring it undoes the restore.
    const safety = history.getByRole('button', { name: /^Preview Before restoring/ });
    await expect(safety).toBeVisible();
    await expect(history.getByText('Alice').first()).toBeVisible();
    await safety.click();
    await expect(alice.page.getByRole('dialog').getByTestId('version-preview')).toContainText('PLUS-LATER-WORK');
    await alice.page.getByRole('dialog').getByRole('button', { name: 'Restore this version' }).click();
    await expect(editor(alice.page)).toContainText('PLUS-LATER-WORK');
    await expect(editor(bob.page)).toContainText('PLUS-LATER-WORK', { timeout: 20_000 });

    await alice.context.close();
    await bob.context.close();
  });

  test('a viewer can browse history but not save or restore', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const vera = await registerPerson(browser, 'Vera');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Some history');
    await expectPhase(alice.page, 'synced');
    await alice.page.getByRole('button', { name: 'History' }).click();
    await alice.page.getByRole('complementary', { name: 'Version history' }).getByRole('button', { name: 'Save version' }).click();
    await expect(alice.page.getByRole('complementary', { name: 'Version history' }).getByText('Saved version')).toBeVisible();
    await shareWith(alice.page, vera.email, 'Viewer');

    await openSharedDocument(vera.page, docId);
    await vera.page.getByRole('button', { name: 'History' }).click();
    const history = vera.page.getByRole('complementary', { name: 'Version history' });
    await expect(history.getByText('Saved version')).toBeVisible();
    await expect(history.getByRole('button', { name: 'Save version' })).toHaveCount(0);
    await history.getByRole('button', { name: /^Preview/ }).first().click();
    await expect(vera.page.getByRole('dialog').getByTestId('version-preview')).toContainText('Some history');
    await expect(vera.page.getByRole('dialog').getByRole('button', { name: 'Restore this version' })).toHaveCount(0);

    await alice.context.close();
    await vera.context.close();
  });
});

test.describe('comments', () => {
  test('quote a selection, collaborators read and resolve it, viewers can only read', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const vera = await registerPerson(browser, 'Vera');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'This sentence needs a second look.');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, bob.email, 'Editor');
    await shareWith(alice.page, vera.email, 'Viewer');

    await alice.page.getByRole('button', { name: 'Comments' }).click();
    const panel = alice.page.getByRole('complementary', { name: 'Comments' });
    await editor(alice.page).click();
    await alice.page.keyboard.press('ControlOrMeta+A');
    await panel.getByRole('button', { name: 'Quote selection' }).click();
    await expect(panel.getByText(/This sentence needs a second look/)).toBeVisible();
    await panel.getByLabel('Write a comment').fill('Can we tighten this up?');
    await panel.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(panel.getByText('Can we tighten this up?')).toBeVisible();

    // Comments live outside the document: the text itself is unchanged.
    expect(await bodyText(alice.page)).toBe('This sentence needs a second look.');

    await openSharedDocument(bob.page, docId);
    await bob.page.getByRole('button', { name: 'Comments' }).click();
    const bobPanel = bob.page.getByRole('complementary', { name: 'Comments' });
    await expect(bobPanel.getByText('Can we tighten this up?')).toBeVisible();
    await expect(bobPanel.getByText(/This sentence needs a second look/)).toBeVisible();
    await bobPanel.getByRole('button', { name: 'Resolve' }).click();
    await expect(bobPanel.getByText('Resolved')).toBeVisible();

    await openSharedDocument(vera.page, docId);
    await vera.page.getByRole('button', { name: 'Comments' }).click();
    const veraPanel = vera.page.getByRole('complementary', { name: 'Comments' });
    await expect(veraPanel.getByText('Can we tighten this up?')).toBeVisible();
    await expect(veraPanel.getByLabel('Write a comment')).toHaveCount(0);
    await expect(veraPanel.getByRole('button', { name: 'Resolve' })).toHaveCount(0);

    for (const p of [alice, bob, vera]) await p.context.close();
  });
});
