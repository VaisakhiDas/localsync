import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery staple';

export interface Person {
  name: string;
  email: string;
  context: BrowserContext;
  page: Page;
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A brand-new, isolated "device": its own cookies, IndexedDB, service worker. */
export async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Registers a new account in a fresh isolated browser context and lands on the dashboard. */
export async function registerPerson(browser: Browser, name: string): Promise<Person> {
  const { context, page } = await newDevice(browser);
  const email = `${name.toLowerCase()}.${unique()}@example.com`;
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/); // signed-out visitors are sent to the sign-in page
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await waitForServiceWorker(page);
  return { name, email, context, page };
}

/** Signs an existing account in on a fresh device (e.g. "my laptop" after using "my phone"). */
export async function signInOnNewDevice(browser: Browser, person: Pick<Person, 'name' | 'email'>): Promise<Person> {
  const { context, page } = await newDevice(browser);
  await page.goto('/login');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await waitForServiceWorker(page);
  return { ...person, context, page };
}

/** The app shell is cached by a service worker; wait until it controls the page so offline reloads work. */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 15_000 }).catch(async () => {
    await page.reload(); // first visit: the worker claims the page on the next load
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  });
}

export const editor = (page: Page) => page.getByRole('textbox', { name: 'Document body' });
export const syncChip = (page: Page) => page.locator('[data-sync-phase]');
/**
 * The document's text, WITHOUT presence widgets. Remote carets ("Bob") are drawn inside the editor
 * element but are not content, so they must not be counted when comparing replicas.
 */
export const bodyText = (page: Page) =>
  page.locator('.ProseMirror').evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.collaboration-carets__caret, .ProseMirror-widget, .ProseMirror-separator').forEach((n) => n.remove());
    return (clone.textContent ?? '').replace(/\u200b/g, '');
  });

/** Creates a document from the sidebar and returns its id (from the URL). */
export async function createDocument(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New document' }).first().click();
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/);
  await expect(editor(page)).toBeVisible();
  return page.url().split('/d/')[1]!;
}

// Keyboard shortcuts for "start / end of the whole document" differ by platform.
const isMac = process.platform === 'darwin';

export async function caretToEnd(page: Page) {
  await editor(page).click();
  await page.keyboard.press(isMac ? 'Meta+ArrowDown' : 'Control+End');
}

export async function caretToStart(page: Page) {
  await editor(page).click();
  await page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home');
}

/** Types at the END of the document. */
export async function typeInEditor(page: Page, text: string) {
  await caretToEnd(page);
  await page.keyboard.type(text, { delay: 5 });
}

/** Types at the START of the document. */
export async function typeAtStart(page: Page, text: string) {
  await caretToStart(page);
  await page.keyboard.type(text, { delay: 5 });
}

export async function expectPhase(page: Page, phase: 'offline' | 'connecting' | 'syncing' | 'synced' | 'denied' | 'local' | 'revoked', timeout = 20_000) {
  await expect(syncChip(page)).toHaveAttribute('data-sync-phase', phase, { timeout });
}

/** Ask the app to reconcile its document list now (it also does so every minute and on `online`). */
export async function syncNow(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

export async function shareWith(page: Page, email: string, role: 'Editor' | 'Viewer') {
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Role', { exact: true }).selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByText(email)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
}

/** Opens a document that was shared with this person (waits for their list to pick it up). */
export async function openSharedDocument(page: Page, documentId: string) {
  await page.goto('/');
  await syncNow(page);
  await expect(page.locator(`a[href="/d/${documentId}"]`).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/d/${documentId}`);
  await expect(editor(page)).toBeVisible();
}

export async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expectPhase(page, 'offline');
}

export async function goOnline(context: BrowserContext) {
  await context.setOffline(false);
}
