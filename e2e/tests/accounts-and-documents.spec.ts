import { expect, test } from '@playwright/test';
import { bodyText, createDocument, editor, expectPhase, PASSWORD, registerPerson, signInOnNewDevice, typeInEditor } from '../helpers';

test.describe('accounts', () => {
  test('visitors are sent to sign in; registering lands on an empty dashboard; the session survives a reload', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    await expect(ada.page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
    await ada.page.reload();
    await expect(ada.page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible(); // still signed in
    await ada.context.close();
  });

  test('signing out ends the session; signing back in works; a wrong password is rejected with one generic message', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    await ada.page.getByRole('button', { name: /Ada/ }).first().click();
    await ada.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(ada.page).toHaveURL(/\/login$/);

    await ada.page.getByLabel('Email').fill(ada.email);
    await ada.page.getByLabel('Password').fill('definitely not the password');
    await ada.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(ada.page.getByRole('alert')).toHaveText('Incorrect email or password.');

    await ada.page.getByLabel('Password').fill(PASSWORD);
    await ada.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(ada.page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await ada.context.close();
  });

  test('another account on the same browser never sees the first account\'s local documents', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    const docId = await createDocument(ada.page);
    await typeInEditor(ada.page, 'Ada private notes');
    await expectPhase(ada.page, 'synced');

    // Same browser profile (same IndexedDB), different account.
    await ada.page.getByRole('button', { name: /Ada/ }).first().click();
    await ada.page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await ada.page.getByRole('link', { name: 'Create an account' }).click();
    await ada.page.getByLabel('Your name').fill('Eve');
    await ada.page.getByLabel('Email').fill(`eve.${Date.now()}@example.com`);
    await ada.page.getByLabel('Password').fill(PASSWORD);
    await ada.page.getByRole('button', { name: 'Create account' }).click();
    await expect(ada.page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
    await ada.page.goto(`/d/${docId}`);
    await expect(ada.page.getByText('Document not found')).toBeVisible(); // not in Eve's namespace, not hers on the server
    await ada.context.close();
  });
});

test.describe('documents and local persistence', () => {
  test('create, edit, rename, reload: everything is still there, and the server has acknowledged it', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    const { page } = ada;
    await createDocument(page);
    await expect(editor(page)).toBeEditable(); // editor initialises empty and editable
    expect((await bodyText(page)).trim()).toBe(''); // ProseMirror reports "\n" for an empty paragraph

    await typeInEditor(page, 'Hello persistence');
    await expectPhase(page, 'synced');
    await page.getByRole('textbox', { name: 'Document title' }).fill('Quarterly plan');
    await page.keyboard.press('Enter');
    // The sidebar updates only after the rename has been committed to IndexedDB: wait for that
    // observable signal instead of reloading mid-write (a page can always unload during a transaction).
    await expect(page.getByRole('navigation', { name: 'Documents' }).getByText('Quarterly plan')).toBeVisible();

    await page.reload();
    await expect(editor(page)).toContainText('Hello persistence');
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Quarterly plan');
    await expectPhase(page, 'synced');
    await ada.context.close();
  });

  test('formatting survives a reload (bold, heading, list)', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    const { page } = ada;
    await createDocument(page);
    await editor(page).click();
    await page.getByRole('button', { name: 'Heading 2' }).click();
    await page.keyboard.type('A heading');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Bulleted list' }).click();
    await page.keyboard.type('first item');
    await expectPhase(page, 'synced');
    await page.reload();
    await expect(page.locator('.ProseMirror h2')).toHaveText('A heading');
    await expect(page.locator('.ProseMirror ul li')).toHaveText('first item');
    await ada.context.close();
  });

  test('a second device signed in as the same user receives the document from the server', async ({ browser }) => {
    const phone = await registerPerson(browser, 'Ada');
    const docId = await createDocument(phone.page);
    await typeInEditor(phone.page, 'Started on my phone');
    await expectPhase(phone.page, 'synced');

    const laptop = await signInOnNewDevice(browser, phone);
    await expect(laptop.page.locator(`a[href="/d/${docId}"]`).first()).toBeVisible({ timeout: 20_000 });
    await laptop.page.goto(`/d/${docId}`);
    await expect(editor(laptop.page)).toContainText('Started on my phone');
    await phone.context.close();
    await laptop.context.close();
  });

  test('renaming and deleting from the dashboard', async ({ browser }) => {
    const ada = await registerPerson(browser, 'Ada');
    const { page } = ada;
    await createDocument(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Rename Untitled document' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Renamed on the dashboard');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('link', { name: /Renamed on the dashboard/ }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Delete Renamed on the dashboard' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
    await ada.context.close();
  });
});
