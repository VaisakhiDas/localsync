# Demo script: two windows, one document

A live demonstration of the headline behaviour: **concurrent editing, going offline, continuing on the other side, reconnecting, and verifying convergence and persistence.** Takes about 10 minutes. The steps marked 🤖 are automated in `e2e/tests/` (so you can also just run `npm run test:e2e` and watch the same scenarios pass); everything else is a manual check.

## Setup

```bash
npm install
```

```bash
npm run dev
```

In a second terminal (once):

```bash
npm run seed
```

You need **two isolated browser sessions** (separate cookies and IndexedDB, i.e. two "devices"):

* **Window A**: a normal Chrome window → http://localhost:5173
* **Window B**: a Chrome **Incognito** window (or another Chrome profile / another browser) → http://localhost:5173

> Use `localhost`, not `127.0.0.1`: the server's origin allow-list is exact.

Place the windows side by side. Open DevTools (⌥⌘I) in **Window B** and keep its **Network** tab visible: you will use its *Offline* switch.

## Part 1: Create, share, collaborate 🤖

| # | Where | Do | Expect |
|---|---|---|---|
| 1 | A | Sign in as `alice@example.com` / `demo-password-123`. Click **New document**. | Editor opens, empty. Chip **Connecting** then **Synced**; second chip **Saved on this device** |
| 2 | A | Type `Meeting notes. ` | The chip flickers **Syncing** and settles on **Synced** (that means PostgreSQL has it) |
| 3 | A | **Share** → email `bob@example.com`, role **Editor** → **Invite** → **Done** | Bob appears in "People with access" |
| 4 | B | Sign in as `bob@example.com` / `demo-password-123`. | Within a few seconds the document appears in the sidebar (if not, reload once) |
| 5 | B | Open it. | `Meeting notes.` is already there. **Synced**. An avatar **A** appears in the top bar, and in Window A an avatar **B** |
| 6 | A and B | Click into the text in both and **type at the same time** (e.g. A: `ALICE-1 ALICE-2 ALICE-3`, B: `BOB-1 BOB-2 BOB-3`) | Both texts appear in **both** windows; coloured carets with names move; "Bob is typing…" shows briefly in A. The two windows end up **identical** |

## Part 2: Disconnect, edit offline, edit on the other side, reconnect 🤖

| # | Where | Do | Expect |
|---|---|---|---|
| 7 | B | DevTools → Network → tick **Offline** | Chip turns amber **Offline**; a banner says your changes are saved on this device |
| 8 | B | Type `BOB-OFFLINE-EDIT ` | The editor stays fully usable. Chip stays **Offline** (it never claims "Synced"). **Saved on this device** is still shown |
| 9 | A | Type `ALICE-ONLINE-EDIT ` | Chip → **Synced**. This text does **not** appear in B yet, and B's text does not appear in A |
| 10 | B | (optional) press **⌘R / reload** while still offline. *(Needs the production build, see Part 4; skip on the dev server.)* | Page still loads from the service worker, with the offline text restored from IndexedDB |
| 11 | B | Untick **Offline** | Chip → **Connecting** → **Syncing** → **Synced** |
| 12 | A and B | Look at both windows | **Both** contain `BOB-OFFLINE-EDIT` **and** `ALICE-ONLINE-EDIT`, in the **same order**. No text lost, none duplicated |

Repeat steps 7-12 two or three times, editing on both sides each round: the result stays identical and nothing is duplicated 🤖 (*"repeated network loss"* test).

## Part 3: Persistence 🤖

| # | Do | Expect |
|---|---|---|
| 13 | Reload **A** and **B** | Text is unchanged immediately (restored from IndexedDB), then **Synced** |
| 14 | Open a **third** Incognito window, sign in as `alice@example.com`, open the document | The full merged text appears, even though this browser had nothing stored: it came from the server's PostgreSQL |
| 15 | In the terminal press `Ctrl+C` (stops PostgreSQL cleanly), run `npm run dev` again, reload A | Text still there. **Synced** again once the server is back. (While the server was down, A showed **Offline** and stayed editable.) |

## Part 4: Reload while offline (production build) 🤖

The service worker exists only in the production build:

```bash
npm run build
```

```bash
npm run preview -w frontend
```

(with the backend running). Open http://localhost:4173, sign in, open a document, wait for **Synced**. Then:

1. DevTools → Network → **Offline**, type something, **reload the page** → the page loads, the text is there, chip **Offline**.
2. Untick **Offline** → **Synced**.
3. Optional, harsher: stop the backend *and* the preview server, reload the tab → the app still opens from the service worker with your documents.

## Part 5: Permissions 🤖

| # | Do | Expect |
|---|---|---|
| 16 | In A, share the document with `vera@example.com` as **Viewer**. In a third window sign in as Vera and open it | Read-only: toolbar disabled, a "view-only access" note, and Share shows the people list but no invite form. Live edits from A still appear |
| 17 | In Vera's DevTools console run `document.querySelector('.ProseMirror').setAttribute('contenteditable','true')`, then type | Her own screen changes, but **nothing reaches Window A**, and a fresh sign-in shows no trace: the server discards a viewer's writes |
| 18 | In A: **Share → Remove Bob** | Bob's open editor is cut off within seconds and becomes a read-only copy: chip **No longer shared**, a red note, his text still visible (nothing is discarded). On his dashboard he can **Remove** the copy |
| 19 | In A: **Share →** change Vera to **Editor** | Vera's open editor becomes editable without a reload (within a few seconds), and what she types reaches A |
| 20 | Sign in as a user with no access, open `http://localhost:5173/d/<the document id>` | "Document not found" (never "forbidden": the server does not confirm the id exists) |

## Part 6: Versions and comments 🤖

| # | Do | Expect |
|---|---|---|
| 21 | In A: **History** → name `Draft one` → **Save version**. Keep typing. | The version appears with your name |
| 22 | **Preview** the version | A read-only view of the *old* text; the live text is untouched |
| 23 | **Restore this version** | The text goes back in A **and** in B (it is a normal edit), and a new entry **Before restoring "Draft one"** appears |
| 24 | Preview **Before restoring…** → **Restore** | The later text returns: the restore itself is undone |
| 25 | **Comments**: select some text, **Quote selection**, write a comment, **Comment** | Appears for B (open the panel); B can **Resolve**; Vera can read but not write |

## Verification checklist

Tick each when you have seen it:

- [ ] Two windows converge after typing at the same time
- [ ] Presence: avatars, carets, "is typing…" (and they vanish when someone leaves)
- [ ] Offline chip appears; editing continues; chip never says "Synced" while offline
- [ ] After reconnecting both windows contain **both** offline and online edits, in the same order
- [ ] A third, empty browser receives the merged document from the server
- [ ] Reload keeps all text (IndexedDB), including while offline (production build)
- [ ] Viewer cannot change the document, even by tampering with the page
- [ ] Removing a collaborator cuts off their *open* editor, leaving a read-only copy
- [ ] Version restore appears in both windows and can itself be undone

## Simulating outages without DevTools

* Stop only the backend: `Ctrl+C` the `[api]` process (or run the three pieces separately with `npm run dev:db`, `npm run dev:backend`, `npm run dev:frontend`). Clients show **Offline** and keep working; start it again and they re-sync by themselves.
* Turn off Wi-Fi: the browser's `offline` event stops reconnect attempts at once; turning it on resumes.
