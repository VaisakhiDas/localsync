# LocalSync

A **local-first collaborative rich-text editor**. Several people can edit the same document at the same time; every client edits its own local copy first, documents keep working with no internet and survive reloads, and when the connection returns the replicas merge through Yjs CRDTs without losing valid edits. The server synchronises and stores documents, but it is **not the only place the data lives**.

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, TipTap 3 (ProseMirror) |
| Collaboration | Yjs 13, `@tiptap/extension-collaboration`, `y-websocket` (client), `y-protocols` (server) |
| Local persistence | IndexedDB via `y-indexeddb` and `idb`; service worker via `vite-plugin-pwa` |
| Backend | Node.js, TypeScript, Express 5, `ws` |
| Database | PostgreSQL 17 (accounts, sessions, documents, memberships, merged Yjs state, versions, comments) |

![Architecture diagram](docs/architecture.svg)

**Where to go next:** [Architecture](docs/architecture.md) · [CRDTs explained for a viva](docs/concepts.md) · [Two-window demo script](docs/demo-script.md) · [Database schema](docs/database.md) · [Test report](docs/test-report.md)

## Purpose

Most web editors keep the "real" document on a server and treat your browser as a window onto it: lose the connection and you lose the ability to work, and two people editing at once is a conflict to be refereed by a server. LocalSync takes the opposite position, known as **local-first** software:

* **Your device holds a complete, editable copy.** Edits are applied and saved locally first, so the editor is instant and keeps working on a train, in a lift, or when the server is down.
* **Merging is mathematics, not arbitration.** Documents are Yjs CRDTs, so edits made by different people, in any order, online or offline, converge to the same text on every device without losing valid work.
* **The server is a helper.** It authenticates people, enforces who may do what, relays changes, stores a durable copy, and tells each client truthfully when its changes are safe, but it is not the only place the data lives.

It is also a teaching-quality reference for how those pieces fit together: the code is commented where the design is non-obvious, and [docs/concepts.md](docs/concepts.md) explains CRDTs, `Y.Doc`, persistence, sync and conflict handling at second-year level.

---

## Status: what is built and how well it is verified

All eight milestones are implemented. "Verified" means covered by an automated test that was run; the [test report](docs/test-report.md) lists every test, what passed, and what is **not** verified.

| Milestone | Feature | Verified by |
|---|---|---|
| 1 | Dashboard, create / open / rename / delete, TipTap editor, toolbar (headings, bold, italic, lists, links, blockquote, code block), empty / loading / error states | component tests, e2e |
| 2 | Local persistence in IndexedDB, restored before sync starts, visible storage errors | unit tests with real IndexedDB semantics, e2e (reload) |
| 3 | One `Y.Doc` per document id, Yjs-aware undo, `y-websocket` provider, editor stays editable offline | integration + e2e |
| 4 | Separate sync server on `y-protocols`: rooms, lifecycle, reconnect, graceful shutdown, origin allow-list, access control | 33 integration tests + 6 mutation checks |
| 5 | Offline / Connecting / Syncing / **Synced** driven by *server acknowledgements*, service worker, offline create / edit / reload | integration + e2e + manual |
| 6 | PostgreSQL, migrations, scrypt passwords, revocable sessions, authorization on HTTP **and** WebSocket | 59 API / database / realtime-auth tests + 8 mutation checks |
| 7 | Sharing (owner / editor / viewer), read-only enforced on the server, presence, typing indicator | component + integration + e2e |
| 8 | Version history (save, preview, restore as a new edit), comments | 11 integration + 21 unit / component + 3 e2e + 5 mutation checks |

Automated: **236 unit / integration tests + 25 browser end-to-end tests (261 total)**, all passing. Lint and type-check clean; production build succeeds; `npm audit` reports 0 vulnerabilities. See [Known limitations](#known-limitations) before relying on any feature in production.

---

## Quick start

### Prerequisites

* **Node.js ≥ 20.17** (checked on 20.17.0 and 22.22.2) and npm ≥ 10.
* That is all. **PostgreSQL does not need to be installed**: `npm run dev` starts a real PostgreSQL 17 from binaries shipped in the `embedded-postgres` npm package. (To use your own PostgreSQL, see [Database](#database).)
* Google Chrome, only if you want to run the end-to-end tests.

Developed and tested on macOS (Apple Silicon). Linux should work; Windows is untested.

### Run it

```bash
npm install
```

```bash
npm run dev
```

This starts PostgreSQL (data in `backend/.pgdata`), the backend on `:4000` (applies migrations), and the Vite dev server on **http://localhost:5173**. `Ctrl+C` stops all three cleanly.

In a second terminal, create demo accounts and a shared document (optional):

```bash
npm run seed
```

| Account | Password | Role on "Demo: shared notes" |
|---|---|---|
| `alice@example.com` | `demo-password-123` | owner |
| `bob@example.com` | `demo-password-123` | editor |
| `vera@example.com` | `demo-password-123` | viewer |

The seed script refuses to run when `NODE_ENV=production` (the passwords are public). Or just click **Create an account**.

To see the product's headline behaviour, follow the [two-window demo script](docs/demo-script.md).

### Offline reload needs the production build

The service worker (which lets the page itself load with no network) is **only active in the production build**, not under `npm run dev`. To try "reload while offline":

```bash
npm run build
```

```bash
npm run preview -w frontend
```

(with the backend still running; the preview server listens on http://localhost:4173, which is in the default `ALLOWED_ORIGINS`).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | PostgreSQL + backend + frontend, one terminal |
| `npm run dev:db` / `dev:backend` / `dev:frontend` | start one piece separately |
| `npm run migrate` | apply pending database migrations (idempotent) |
| `npm run seed` | create demo accounts and a shared document (not in production) |
| `npm run build` | type-check and build the frontend (`frontend/dist`) |
| `npm run lint` | ESLint over the whole repo |
| `npm run typecheck` | `tsc` for shared, frontend, backend and e2e |
| `npm test` | all unit and integration tests (shared, frontend, backend) |
| `npm run test:e2e` | Playwright end-to-end tests (builds the frontend, starts a throwaway PostgreSQL and backend) |
| `npm run check` | lint + typecheck + test + build |
| `npm run start -w backend` | run the backend without file watching (see [Production notes](#production-notes)) |

## Project layout

```
shared/            domain rules, API contract (zod), wire protocol, acknowledgement logic, SyncController
frontend/src/
  components/      dashboard list, dialogs, share / history / comments panels, user menu
  pages/           Dashboard, Editor, Login / Register
  editor/          TipTap setup, toolbar, status chips, presence bar
  hooks/           auth + documents contexts, useLocalDocument, useSyncStatus
  lib/             stores (IndexedDB / memory), metadata sync, API client, presence, versions
backend/
  migrations/      numbered, checksummed SQL migrations
  src/routes/      auth, documents (+ sharing), versions, comments
  src/middleware/  sessions, CSRF origin check, validation, errors
  src/services/    passwords (scrypt), sessions, users, documents, versions, comments
  src/realtime/    WebSocket server, rooms, awareness sanitiser, PostgreSQL authorizer + persistence
  src/db/          pool, migration runner, embedded PostgreSQL helper
  scripts/         dev-db, migrate, seed, e2e-server
e2e/               Playwright specs (two isolated browsers, offline, permissions)
docs/              architecture, concepts, demo script, schema, test report
```

---

## Configuration

`npm run dev` needs **no configuration**. Settings come from real environment variables, optionally from a `.env` file (copy [`.env.example`](.env.example); the file is git-ignored). Real environment variables always take precedence. `.env.example` contains placeholders only.

| Variable | Default | Meaning |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `4000` | where the backend listens |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | browser origins allowed to call the API and open WebSockets (exact match). **Set this to your real site in production.** |
| `DATABASE_URL` | local dev database (outside production only) | PostgreSQL connection string. **Required in production.** |
| `AUTO_MIGRATE` | `true` | apply migrations on server start; set `false` to run `npm run migrate` as a deploy step |
| `NODE_ENV` | `development` | `production` turns on secure cookies and disables the demo seed |
| `COOKIE_SECURE` | `true` in production | send the session cookie only over HTTPS |
| `SESSION_TTL_DAYS` | `14` | session lifetime |
| `SCRYPT_COST` | `32768` | password-hash cost (N). Old hashes keep verifying after a change |
| `TRUST_PROXY` | `0` | proxy hops to trust for client IPs (rate limiting). Use `1` behind one reverse proxy |
| `AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS` | `30`, `600000` | login / register attempts per IP per window |
| `MAX_MESSAGE_BYTES` | `8388608` | largest single WebSocket message |
| `MAX_MESSAGES_PER_SECOND` | `500` | per-connection flood limit |
| `PERSIST_DEBOUNCE_MS`, `PERSIST_MAX_WAIT_MS` | `500`, `5000` | when a changed document is saved |
| `ROOM_IDLE_MS` | `30000` | how long an empty room stays in memory |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | cap on graceful shutdown |
| `AUTO_VERSION_INTERVAL_MS`, `AUTO_VERSIONS_KEPT` | `600000`, `50` | automatic version checkpoints |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

Invalid configuration stops the server at start-up with a list of what is wrong.

The frontend has no environment variables: it talks to **its own origin**, and the Vite dev / preview server (or your reverse proxy) forwards `/api` and `/collab` to the backend. Set `BACKEND_URL` when starting Vite if the backend is not on `http://127.0.0.1:4000`.

---

## Database

* **Development / tests:** `npm run dev:db` (included in `npm run dev`) runs a real PostgreSQL 17 on port `54320`, data in `backend/.pgdata`. Delete that folder to start over. The tests start their own throwaway instance.
* **Your own PostgreSQL** (tested only on 17; 13 or newer is expected to work): create an empty database and user, set `DATABASE_URL`, and run migrations:

  ```bash
  DATABASE_URL="postgres://user:password@host:5432/localsync" npm run migrate
  ```

* **Migrations** live in `backend/migrations/` as numbered SQL files (`001_initial.sql`, `002_versions_and_comments.sql`). Each runs in its own transaction, is recorded with a SHA-256 checksum in `schema_migrations`, and a file that was edited after being applied makes the runner refuse to continue (write a new migration instead). A PostgreSQL advisory lock serialises concurrent runners.
* **Schema:** see [docs/database.md](docs/database.md). Rich text is stored **only** as a Yjs state in `document_states.state` (`bytea`), never as HTML or JSON rows.

---

## How it works (the short version)

1. **Local first.** Every keystroke becomes a Yjs update applied to a local `Y.Doc` and appended to IndexedDB. The network is optional.
2. **Sync is a handshake, not a queue.** On every (re)connect the client and server exchange state vectors and send each other exactly the operations the other lacks. Offline edits just sit in the `Y.Doc`; duplicates and re-deliveries are harmless because Yjs updates are idempotent.
3. **"Synced" is earned.** The server acknowledges a snapshot only **after** it has been written to PostgreSQL; the client compares it with its own document (state vector *and* delete set, because deleting text does not advance the state vector). Saved locally ≠ stored on the server, and the UI shows both separately.
4. **Permissions live on the server.** The role comes from the database on every request and every WebSocket connection. Viewers' writes are dropped server-side; changing or revoking a role disconnects the affected sockets immediately.
5. **Metadata is simpler than content.** Titles, the document list and deletions use plain last-write-wins with a few "not yet sent" flags per document (`registered`, `titleDirty`, deletion tombstone), because a title is one small value, not a CRDT.

Details and the reasoning behind each decision: [docs/architecture.md](docs/architecture.md). A student-level explanation of CRDTs, `Y.Doc`, persistence and conflict handling: [docs/concepts.md](docs/concepts.md).

---

## Testing

| Kind | Command | What it covers |
|---|---|---|
| Unit / component | `npm test -w frontend` | stores on real IndexedDB semantics, reload restoration, editor toolbar, sync status, metadata sync engine, auth forms, share / history / comments panels, presence |
| Protocol | `npm test -w shared` | two independent `Y.Doc`s converging in both directions, randomised 3-replica convergence, delete-only acknowledgement |
| Integration | `npm test -w backend` | real WebSocket server + real clients (`SyncController`) + real PostgreSQL: convergence, offline / reconnect, abrupt network loss, read-only enforcement, hostile input, persistence, migrations, HTTP authorization matrix |
| End-to-end | `npm run test:e2e` | **two isolated Chrome browsers**: shared editing, offline edit then reconnect, reload while offline (service worker), permission denied, version restore, comments |

The end-to-end run uses the Google Chrome already installed on your machine (no browser download). If you do not have Chrome: `npx playwright install chromium` and remove `channel: 'chrome'` from `e2e/playwright.config.ts`.

**Manual tests** (the browser pane cannot be driven from the automated suite) are listed in the [test report](docs/test-report.md#manual-checks-and-what-is-not-verified) together with the [demo script](docs/demo-script.md).

---

## Security model

* Passwords: **scrypt** (N=32768, r=8, p=1, per-user salt), constant-time comparison, Unicode-normalised. Login also verifies a dummy hash for unknown emails so response times should not reveal which accounts exist (designed in; response timing was not measured).
* Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); only its **SHA-256** is stored, so a database leak yields no usable sessions; logout revokes immediately and drops that session's sockets. No session is ever reused across logins.
* Authorization: enforced on every HTTP endpoint and every WebSocket upgrade from the database. Non-members get the **same 404 / 4403** as for a document that does not exist. The client never supplies a user id or role (extra fields in request bodies are ignored; this is tested).
* CSRF / hijacking: `SameSite=Lax` + `Origin` allow-list on state-changing requests and on WebSocket upgrades + JSON-only bodies.
* Input: every body is validated with zod; the JSON body limit is 100 kB; WebSocket frames are binary-only, size-limited, rate-limited, and decoded with `y-protocols` (malformed input closes only that connection). The server relays what *changed*, never raw client bytes.
* Presence is untrusted: names / colours are rewritten from the authenticated account, a client cannot write another user's presence slot.
* Secrets: none in the repository; `.env.example` has placeholders only.

---

## Production notes

This repository is a complete application, but it has **not** been deployed anywhere. Things you must do yourself:

* **Serve over HTTPS** and keep `COOKIE_SECURE` on (the default in production).
* **Same origin:** the app is designed so the browser talks to a single origin. Serve `frontend/dist` and proxy `/api/*` and `/collab/*` (with WebSocket upgrade) to the backend. An **untested** Caddy example:

  ```
  notes.example.com {
    handle /api/*    { reverse_proxy 127.0.0.1:4000 }
    handle /collab/* { reverse_proxy 127.0.0.1:4000 }
    handle {
      root * /srv/localsync/frontend/dist
      try_files {path} /index.html
      file_server
    }
  }
  ```

  and set `ALLOWED_ORIGINS=https://notes.example.com`, `TRUST_PROXY=1`, `NODE_ENV=production`, `DATABASE_URL=...`.
* The backend is started with `tsx` (`npm run start -w backend`); there is no compiled `dist` for it, and `npm run build` builds the frontend only.
* **Run one backend instance.** Rooms live in process memory; see the first limitation below.
* Back up PostgreSQL. `document_states` and `document_versions` hold the only server-side copy of document content.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Syntax errors or missing APIs on start | Node is too old. Use Node ≥ 20.17 (`nvm install 22 && nvm use 22`). |
| `cannot reach PostgreSQL` when starting the backend alone | Start the database first (`npm run dev:db`) or use `npm run dev`, or set `DATABASE_URL`. |
| `npm run dev:db` fails or hangs after a crash | A stale lock: stop any leftover `postgres` processes, delete `backend/.pgdata`, retry (this deletes local dev data). |
| `Port 5173 is already in use` (or 4000, 4173, 54320) | Another process holds it; stop it. Vite is configured to fail rather than silently pick another port, because the CORS/origin allow-list depends on the port. |
| Page shows "Cannot reach the server" / Offline although the backend runs | Open `http://localhost:5173` (not `127.0.0.1`: the origin allow-list is exact). Check `http://localhost:5173/api/health`. |
| WebSocket closes immediately; status "No access" | Close code **4401** = not signed in / session expired; **4403** = you are not a member of this document (or it was deleted). Both are deliberate and the client will not retry. |
| Reload while offline shows a browser error page | You are on the dev server. The service worker exists only in the production build (`npm run build`, then `npm run preview -w frontend`). Also load the app once online first. |
| Stale UI after an update | The service worker updates silently; reload the tab (or clear site data) once. |
| "Local storage is unavailable" banner | The browser blocks IndexedDB (private window with site data blocked, or the disk is full). Your edits cannot be saved on this device; free space or leave private mode. |
| Two browser tabs of the same document do not show each other's offline edits | By design: tabs synchronise through the server, not directly, so "Synced" always means *the server has it*. They merge as soon as both are online. |
| `npm run test:e2e` cannot find Chrome | Install Google Chrome, or see the note under [Testing](#testing). |
| A test fails with a port error | The e2e suite uses ports 4100 and 4173; stop anything on them. |

---

## Known limitations

These are real, and deliberately stated rather than hidden. Nothing here is claimed to work beyond what is described.

1. **Single backend instance.** Each document's room lives in one process's memory. Running several instances behind a load balancer would split collaborators of the same document across processes. Scaling out needs sticky routing by document id or a pub/sub layer between instances: **not implemented**.
2. **Whole-state persistence.** Each save writes the full merged Yjs state of a document (and a full copy per version). That is fine for ordinary documents; very large documents will make saves slower. There is no incremental update log and no per-document size quota (only the per-message limit).
3. **Presence is online-only** and disappears when a client goes offline.
4. **Comments** are fetched over HTTP and refreshed every 10 seconds while the panel is open (no live push), need a connection, and are attached to a **quoted copy** of text, not a live position: if the text is edited, the quote stays as written. Only editors and the owner can write them.
5. **Version restore** is a new edit that replaces the content with the old version. Text a collaborator types *at the same moment into a paragraph that the restore deletes* is superseded with it (it is not destroyed: the automatic "Before restoring…" version contains it). Saving and restoring versions needs a connection and the "Synced" state.
6. **A revoked document stays on the device.** When the owner deletes a document or removes you, your copy is kept as a clearly labelled **read-only copy** (so edits that never reached the server are not discarded). It remains readable by anyone using that browser profile until you remove it from the document list. Use **Sign out and remove local data** on shared computers.
7. **Metadata conflicts are last-write-wins** (titles). Document *content* never loses concurrent edits.
8. **No account recovery features:** no password reset, email verification, two-factor authentication, account deletion, or ownership transfer. Registration and "invite by email" reveal whether an email has an account (rate-limited; a conscious trade-off for a collaboration tool).
9. **Sign-in and sign-out need the network** (the server must verify credentials / revoke the session). Offline, the app opens with the remembered identity so local work stays reachable. A normal sign-out keeps documents on the device; use **Sign out and remove local data** on shared computers.
10. **Browser support:** automated tests ran in Chrome only. Firefox and Safari are **untested** (IndexedDB, service workers and WebSockets are standard, but nothing is claimed).
11. **Accessibility** follows good practice (labelled controls, dialogs with focus handling, live regions, keyboard operation) but has **not** been audited with a screen reader or an automated checker such as axe.
12. **Installability (PWA)** metadata is included but installation behaviour was not verified.
13. **Two tabs of one browser** sync through the server only (cross-tab `BroadcastChannel` is turned off so the sync status stays truthful); while offline they merge on reload / reconnect, not live.
14. The development database (`embedded-postgres`) is for development and tests; use a managed or system PostgreSQL in production.

## Roadmap (planned, **not implemented**)

Ideas that would be natural next steps. None of these exist yet.

* Horizontal scaling of the realtime server (sticky routing by document id, or a pub/sub layer between instances)
* Incremental update storage and compaction instead of whole-state saves; per-document size quotas
* Live comment delivery over the WebSocket, and comments anchored to text positions
* Account recovery: password reset, email verification, two-factor authentication, account deletion, ownership transfer
* Public / link sharing and an audit log of permission changes
* Compiled backend build and a container image; documented, tested production deployment
* Cross-browser and accessibility audits (Firefox, Safari, screen readers)

## License

No license has been chosen. Add one before sharing the code.
