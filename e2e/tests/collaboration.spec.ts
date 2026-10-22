import { expect, test } from '@playwright/test';
import { bodyText, createDocument, editor, expectPhase, openSharedDocument, registerPerson, shareWith, signInOnNewDevice, typeAtStart, typeInEditor } from '../helpers';

test.describe('two people, one document (two isolated browsers)', () => {
  test('Alice shares with Bob; both edit at the same time and converge; presence shows who is here', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');

    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Shared start. ');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, bob.email, 'Editor');

    await openSharedDocument(bob.page, docId);
    await expect(editor(bob.page)).toContainText('Shared start.'); // Bob receives the existing content
    await expectPhase(bob.page, 'synced');
    await expect(alice.page.getByText('Bob is here')).toBeVisible(); // presence: ephemeral, from awareness
    await expect(bob.page.getByText('Alice is here')).toBeVisible();

    // Concurrent typing in DIFFERENT places (Alice at the end, Bob at the start): nobody waits for anybody,
    // and both phrases arrive intact.
    await Promise.all([typeInEditor(alice.page, 'ALICE-TYPES-THIS '), typeAtStart(bob.page, 'BOB-TYPES-THAT ')]);
    // Read the document text WITHOUT presence widgets: a remote caret label ("Bob") is drawn inside the editor at his cursor.
    await expect.poll(() => bodyText(alice.page), { timeout: 20_000 }).toContain('BOB-TYPES-THAT Shared start. ALICE-TYPES-THIS');
    await expect.poll(() => bodyText(bob.page), { timeout: 20_000 }).toContain('BOB-TYPES-THAT Shared start. ALICE-TYPES-THIS');
    await expectPhase(alice.page, 'synced');
    await expectPhase(bob.page, 'synced');
    expect(await bodyText(alice.page)).toBe(await bodyText(bob.page)); // identical replicas

    await alice.context.close();
    await bob.context.close();
  });

  test('typing at the SAME spot at the same instant: nothing is lost and both replicas are identical (the characters may interleave)', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Base. ');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, bob.email, 'Editor');
    await openSharedDocument(bob.page, docId);
    await expect(editor(bob.page)).toContainText('Base.');
    await expectPhase(bob.page, 'synced');

    // Both people type at the end of the document at the same moment. Where a remote character lands
    // right at someone's caret, the rest of what they type can land between the other person's
    // characters (exactly as in any collaborative editor). The guarantee is convergence without loss,
    // not that the two phrases stay contiguous.
    await Promise.all([typeInEditor(alice.page, 'ALICE-TYPES-THIS '), typeInEditor(bob.page, 'BOB-TYPES-THAT ')]);
    await expectPhase(alice.page, 'synced');
    await expectPhase(bob.page, 'synced');
    const sorted = (text: string) => [...text].sort().join('');
    await expect.poll(async () => sorted(await bodyText(alice.page)), { timeout: 20_000 }).toBe(sorted('Base. ALICE-TYPES-THIS BOB-TYPES-THAT '));
    expect(await bodyText(alice.page)).toBe(await bodyText(bob.page)); // identical text on both sides

    await alice.context.close();
    await bob.context.close();
  });

  test('collaborators see each other\'s cursor and a typing indicator, and neither is stored in the document', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await typeInEditor(alice.page, 'Some text to put a cursor in. ');
    await expectPhase(alice.page, 'synced');
    await shareWith(alice.page, bob.email, 'Editor');
    await openSharedDocument(bob.page, docId);
    await expectPhase(bob.page, 'synced');

    const longText = 'Bob keeps typing for a little while so the indicator has time to show. '.repeat(3);
    const typing = typeInEditor(bob.page, longText);
    await expect(alice.page.getByTestId('typing-indicator')).toHaveText('Bob is typing…');
    await expect(alice.page.locator('.collaboration-carets__label').filter({ hasText: 'Bob' }).first()).toBeAttached();
    await typing;
    await expect(alice.page.getByTestId('typing-indicator')).toHaveText('', { timeout: 10_000 }); // ephemeral: gone after a pause

    // Presence is not content: the document text contains none of it.
    expect(await bodyText(alice.page)).not.toContain('is typing');
    await alice.page.reload();
    expect(await bodyText(alice.page)).not.toContain('Bob is');

    await alice.context.close();
    await bob.context.close();
  });

  test('a third device of the same user sees the merged result that the server persisted', async ({ browser }) => {
    const alice = await registerPerson(browser, 'Alice');
    const bob = await registerPerson(browser, 'Bob');
    const docId = await createDocument(alice.page);
    await shareWith(alice.page, bob.email, 'Editor');
    await typeInEditor(alice.page, 'from-alice ');
    await openSharedDocument(bob.page, docId);
    await typeInEditor(bob.page, 'from-bob ');
    await expect(editor(alice.page)).toContainText('from-bob');
    await expectPhase(alice.page, 'synced');
    await expectPhase(bob.page, 'synced');

    const fresh = await signInOnNewDevice(browser, alice); // empty browser: everything must come from the server
    await openSharedDocument(fresh.page, docId);
    await expect(editor(fresh.page)).toContainText('from-alice');
    await expect(editor(fresh.page)).toContainText('from-bob');

    for (const p of [alice, bob, fresh]) await p.context.close();
  });
});
