# Test report

What was run, what passed, and, just as important, what was **not** verified.

## Summary

| Suite | Command | Result |
|---|---|---|
| Unit + component (frontend) | `npm test -w frontend` | **126 / 126 passed** (17 files) |
| Integration + API + database (backend) | `npm test -w backend` | **103 / 103 passed** (9 files) |
| Protocol / CRDT (shared) | `npm test -w shared` | **7 / 7 passed** |
| End-to-end, two real browsers | `npm run test:e2e` | **25 / 25 passed** |
| **Total automated** | | **261 passed, 0 failed** |
| Lint | `npm run lint` | clean |
| Type-check (shared, frontend, backend, e2e) | `npm run typecheck` | clean |
| Production build | `npm run build` | succeeds |
| Dependency audit | `npm audit` | 0 vulnerabilities |

**Environment:** macOS 26.5 (Apple Silicon); Node 20.17.0 (the unit / integration suites were **also** run on Node 22.22.2 with identical results; e2e on 20.17.0 only); Google Chrome 155; PostgreSQL 17.10 (via `embedded-postgres`). Key versions: Yjs 13.6.33, y-websocket 3.1.0, y-indexeddb 9.0.12, TipTap 3.32.0, React 19.3.1, Vite 6.4.5, Vitest 4.1.12, Playwright 1.64.1, Express 5.3.0.

## Automated vs manual

* **Automated** = a command above runs it and reports pass / fail. Everything in the tables below.
* **Manual** = I exercised it by hand in a browser during development (listed in [Manual checks](#manual-checks-and-what-is-not-verified)). Manual checks are *not* repeatable by a command and are labelled as such.

## What each suite really exercises

* **Backend integration tests are not mocked.** They start the real server, connect the *same* `SyncController` the browser uses over **real WebSockets**, and (for accounts) a **real PostgreSQL 17**.
* **Frontend tests use real IndexedDB semantics** (`fake-indexeddb`) rather than mocking storage, so "reload" means "discard every object, reopen the same database".
* **End-to-end tests use isolated browser contexts**, each with its own cookies, IndexedDB and service worker, so two contexts behave like two different devices. They run against the **production build** (so the service worker is real), a real backend and a throwaway PostgreSQL.

### Shared (7)

| File | Tests | Covers |
|---|---|---|
| `protocol.test.ts` | 7 | acknowledgement coverage incl. the **delete-only** case; duplicate / out-of-order delivery; **two independent `Y.Doc`s converge in both directions**; randomised 3-replica convergence (25 rounds, seeded) |

### Backend (103)

| File | Tests | Covers |
|---|---|---|
| `realtime/sync.test.ts` | 11 | edit relay, **concurrent edits converge**, late joiner, persistence + room eviction + reload, server restart, **offline edit then reconnect**, five offline/online cycles, 50-edit burst delivered exactly once, **abrupt network drop** (TCP proxy, no close frame), server-requested reconnect |
| `realtime/security.test.ts` | 17 | 4401 / 4403 refusals and no content leak, malformed ids, **origin allow-list**, role changes on a live socket, messages before auth finishes, **viewer cannot write**, malformed / text / oversized / flood frames, **presence spoofing** |
| `realtime/durability.test.ts` | 5 | "Synced" only after storage (slow DB, failing DB, delete-only edit with a stale ack, server restarted empty), **graceful shutdown flushes** |
| `realtime/accounts.test.ts` | 10 | the same rules with cookie sessions + PostgreSQL: stranger refused, missing / forged / expired session, unregistered documents, demote / remove / logout / delete on **open connections**, restart restores from PostgreSQL |
| `routes/auth.test.ts` | 16 | registration / login validation, scrypt hash stored (never the password; only a hash of the session token), cookie flags, **no account enumeration through login**, session fixation, logout revocation, expiry, **CSRF origin check**, JSON-only / malformed / oversized bodies, SQL metacharacters, rate limit, health |
| `routes/documents.test.ts` | 19 | **authorization matrix** (owner / editor / viewer / stranger / anonymous) on every endpoint, id hijacking refused, smuggled `ownerId` / `role` fields ignored, malformed ids, sharing rules, role changes, owner immutability, one-owner-per-document in the database |
| `routes/versions.test.ts` | 11 | versions freeze the *server's* merged state and are attributed; later edits don't change them; automatic checkpoints are authorless and bounded; authorization; a version id from another document is "not found"; comments CRUD + authorization |
| `services/passwords.test.ts` | 11 | scrypt verify / reject, salting, cost recorded per hash, Unicode normalisation, tampered stored hashes never throw |
| `db/migrate.test.ts` | 3 | schema created and idempotent; editing an applied migration is refused; a failing migration rolls back atomically |

### Frontend (126)

| File | Tests | Covers |
|---|---|---|
| `lib/documentStore.contract.test.ts` | 8 | same behaviour for memory and IndexedDB stores (**document creation**) |
| `lib/idbDocumentStore.test.ts` | 9 | **local persistence across reload**, content restored into a fresh `Y.Doc`, multi-session edits, namespace isolation, deletion removes the body, cross-tab notification, **visible storage failures** (broken IndexedDB, retry) |
| `pages/persistence.test.tsx` | 3 | **typed text survives tearing down and reopening the whole app**, rename persists, storage error shown instead of an empty editor |
| `editor/editor.test.tsx` | 11 | **editor initialisation**, every toolbar format, link dialog rejects `javascript:`, undo, read-only mode |
| `lib/metadataSync.test.ts` | 18 | offline create / rename / delete reach the server later, **in-flight rename not overwritten** (lost-update race), leave vs delete, pull merges, **revoked copies are kept**, UI refresh signal, interruption safety, single-flight |
| `lib/versions.test.ts` | 9 | restore = new edit, formatting kept, concurrent restore converges, restore is undoable |
| `components/*.test.tsx` | 17 | share dialog, history panel (**safety copy saved before restore**), comments panel |
| `pages/dashboard.test.tsx`, `AuthPages.test.tsx`, `hooks/auth-context.test.tsx` | 20 | dashboard states and flows, sign-in / register forms, offline identity |
| `editor/SyncStatus.test.tsx`, `lib/presence.test.ts`, `link.test.ts`, `storageErrors.test.ts`, `time.test.ts` | 31 | status chip never claims "Synced" falsely, presence rules, URL sanitising, error classification |

### End-to-end (25), two isolated Chrome browsers

| Spec | Tests | Scenarios |
|---|---|---|
| `accounts-and-documents` | 7 | sign-in redirect, sign out / in, wrong password, **another account on the same browser sees nothing**, create → edit → rename → **reload keeps everything**, formatting survives reload, **second device receives the document**, dashboard rename / delete |
| `collaboration` | 4 | **share and edit concurrently, replicas identical**, same-spot typing (nothing lost; may interleave), carets + typing indicator (ephemeral, not stored), third device gets the merged persisted result |
| `offline` | 5 | **the demo script** (Bob offline, Alice online, reconnect, converge, fresh device sees both), **reload while offline** via service worker, **create a document offline** then auto-upload, **three offline cycles with no loss or duplication**, offline rename |
| `permissions` | 6 | **viewer read-only in UI and server** (tampering rejected), **stranger blocked** (not listed, "not found", WebSocket 4403, API 404), **no session → 4401**, **removal cuts off an open editor** and keeps a read-only copy, live demotion, live promotion |
| `history-and-comments` | 3 | **save → edit → restore, seen live by the collaborator, then undo the restore**, viewer can browse not restore, quote + resolve comments |

Mapping to the testing requirements in the brief:

| Requirement | Where |
|---|---|
| Document creation | `documentStore.contract`, e2e `accounts-and-documents` |
| Local persistence across reload | `idbDocumentStore`, `persistence.test`, e2e reload tests |
| Editor initialisation | `editor.test`, e2e "editor initialises empty and editable" |
| API authorization | `documents.test` (matrix), `auth.test`, `versions.test` |
| Two independent Yjs docs, both directions | `shared/protocol.test` |
| Two browser instances sharing a document | e2e `collaboration` |
| Offline edit then reconnect | `sync.test`, e2e `offline` |
| Reload while offline | e2e `offline` (service worker) |
| Reconnect after multiple edits / repeated loss | `sync.test`, e2e "three cycles" |
| Duplicate updates | `protocol.test`, `sync.test` ("exactly once") |
| Permission-denied document access | `security.test`, `accounts.test`, e2e `permissions` |

## Mutation checks (do the tests actually fail when the code is wrong?)

For every security- and data-critical rule I **deliberately broke the product code** and confirmed a specific test failed, then restored it. **23 mutations, all caught.** Three survived on the first attempt and exposed weak tests, which I then strengthened (marked ★).

| Area | Mutations (each caught) |
|---|---|
| Sync / security | viewer writes accepted · ack sent *before* durable store · ack ignores deletions ★ · origin check disabled ★ · presence not sanitised · stale ack trusted after reconnect ★ |
| Authorization | any editor may delete · list / get ignore membership · viewers may rename · WS authorizer skips membership · role change doesn't kick open sockets · CSRF origin check disabled · expired sessions accepted · someone else's id can be adopted |
| Metadata sync | upload result clears a newer rename · server title overwrites an unsent rename · purge not-yet-uploaded docs · non-owner "delete" removes the owner's copy |
| Versions / comments | restore forgets to delete current text · restore applied *before* the safety copy · viewers may save versions · version state not scoped to its document · viewers may write comments |

(★ the first versions of those tests did not catch the mutation; the delete-only case in particular needs a *stale* acknowledgement to expose a deletion-blind check. The mutation run is how that weakness was found.)

## Defects found by testing and fixed

Honest list of real problems the tests (or careful verification) uncovered:

1. **Circular import** in the shared package made zod crash while formatting validation errors (every document route returned 500). Found by the first API run; fixed by extracting `domain.ts`.
2. **Document list did not refresh** when a shared document arrived (`insertIfAbsent` reported nothing). Found by the e2e "second device" test; fixed and unit-tested.
3. **Robustness:** unhandled promise on `destroy()` when IndexedDB failed to open; presence parser crashed on a `null` state. Both found by failure-path tests.
4. **Link normaliser** treated `localhost:3000` as a URL scheme. Found by a unit test.
5. **Layout:** the document title was squeezed to 18 px with the header's controls, and side panels crushed the editor at tablet width. Found by measuring in a real browser (not caught by automated tests; the layout is not asserted by them).
6. **Promotion latency:** a viewer promoted to editor stayed read-only until the next list refresh. Found by reviewing the demo script against the code; fixed (role refreshes whenever the connection opens) and covered by an e2e test.
7. **Data-safety:** revoking someone's access would have *discarded their local copy*, including unsynced edits. Found while fixing 6; replaced by a read-only "revoked copy" and tests.

Two e2e assertions were wrong, not the product (they assumed two people typing at the *same spot at the same instant* produce two contiguous phrases; and they read a remote caret label as document text). Both were corrected to assert the real guarantee: replicas identical, nothing lost.

## Manual checks and what is not verified

### Checked by hand in a real browser (not repeatable by a command)

* First-run look and feel: dashboard, editor, toolbar states, mobile (375 px) and tablet-width layouts, the architecture diagram rendering.
* Real Chrome **hard reload** restores typed text (also covered by e2e).
* Production build, **server killed mid-session → UI shows Offline → typing continues → server restarted *empty* → client re-sent everything**; an independent Node client then read the full text back from the restarted server.
* **Reload with the backend and the frontend server both stopped**: the page loaded from the service worker and the document was restored from IndexedDB (also covered by e2e via Playwright's offline mode).
* `npm run dev` from a cold start (fresh PostgreSQL, migrations, seed) and a clean `Ctrl+C`.

### Not verified (do not assume these work)

| Not verified | Why / what is known |
|---|---|
| **Firefox and Safari** | Only Chrome was used. IndexedDB, service workers and WebSockets are standard, but nothing is claimed. |
| **Windows / Linux** | Developed and run on macOS (Apple Silicon) only. |
| **Production deployment**: HTTPS, `Secure` cookies end to end, a reverse proxy | The cookie's `Secure` attribute is unit-tested; the real HTTPS path and the README's Caddy example were **not** tried. |
| **Screen-reader / axe accessibility audit** | Labels, roles, focus handling and live regions are implemented and exercised by tests via accessible names, but no audit was done. |
| **PWA installability** | Manifest present; installation not tried. |
| **Horizontal scaling** | Single backend instance by design (rooms in memory). |
| **Load, large documents, long sessions** | No performance or soak testing. Saves write the whole document state. |
| **Real-world flaky networks** (captive portals, half-open TCP, mobile handover) | Simulated with Playwright offline mode and a TCP proxy that destroys sockets, not with real networks. A silently black-holed connection relies on y-websocket's 30 s watchdog (not tested). |
| **Response-time equality** for known vs unknown emails at login | Implemented (dummy hash) but timing was not measured. |
| **Concurrent restore edge case** | Documented limitation; the convergence is tested, the "text typed into a deleted paragraph is superseded" behaviour is by design. |
| **Visual regression** | No screenshot tests. |

## Reproduce

```bash
npm install
npm run check          # lint + typecheck + unit/integration + build
npm run test:e2e       # needs Google Chrome; builds the frontend and starts its own PostgreSQL + backend
```
