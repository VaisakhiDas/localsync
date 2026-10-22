# CRDTs, Y.Doc, persistence, sync and conflicts: a viva guide

Written for a second-year computer-science student. Every claim here is something this project actually does, and each section points at the code and the test that demonstrates it.

---

## 1. The problem

Two people edit "cat" at the same time. Alice turns it into "cart" (inserts `r`); Bob turns it into "cut" (replaces `a` with `u`). Neither has seen the other's change. What should the document say afterwards, and how do **both** computers arrive at the **same** answer without asking a central server for permission first?

Two families of solutions exist:

| | Operational Transformation (OT) | CRDT |
|---|---|---|
| Idea | A central server orders operations and *transforms* each one against the ones it missed | Make the data structure itself merge-safe, so operations can arrive in **any order** |
| Needs a central authority | Yes (to order operations) | No |
| Offline friendliness | Hard: long offline periods mean transforming against a huge backlog | Natural: merge when you meet |
| Used by | Classic Google Docs | Yjs, Automerge, many local-first apps |

LocalSync uses a CRDT (Yjs) because the requirement is "keep working offline and merge later".

## 2. What is a CRDT?

**CRDT = Conflict-free Replicated Data Type.** A data structure replicated on several computers where:

* every replica can be changed **locally, immediately, without coordination**;
* replicas that have received the **same set of updates** are in the **same state**, regardless of the order or the number of times updates arrived.

That guarantee is called **strong eventual consistency**. It follows from the merge being:

* **commutative** (A then B = B then A),
* **associative** (grouping does not matter),
* **idempotent** (applying the same update twice = once).

Those three properties are exactly why a reconnecting client can safely re-send everything and why duplicate network messages are harmless. *Test:* `shared/src/protocol.test.ts` merges two independent `Y.Doc`s edited concurrently in **both directions** and checks they are identical; another test applies updates out of order and twice; a randomised test does the same with three replicas and random sync order over 25 rounds.

### How Yjs makes text merge-safe (intuition)

Yjs does not store "a string". It stores a sequence of **items**. Every character (more precisely, every run of inserted text) gets a **unique id** `(clientID, clock)`: *who* created it and *their* running counter. An inserted item remembers the ids of the item **to its left and right at the moment it was inserted**.

* "Insert at position 3" is never stored. "Insert *after item (alice, 7)*" is. Positions shift when others type; item ids do not.
* If two people insert at the *same* place concurrently, Yjs orders them with a deterministic rule (using the client ids). Every replica applies the same rule, so every replica picks the same order. No one is "right"; everyone agrees.
* **Deletion does not remove an item.** It marks it deleted (a *tombstone*). The item stays, because a concurrent insert from someone who had not seen the delete may refer to it as its neighbour. Yjs garbage-collects tombstones' content when it safely can.

Worked example. Both replicas start with `c a t` where the items are `c(1) a(2) t(3)`.

* Alice: inserts `r` after `a(2)` → item `r(alice,1)` with left = `a(2)`.
* Bob: deletes `a(2)` and inserts `u` after `c(1)` → `a(2)` is marked deleted; item `u(bob,1)` with left = `c(1)`.
* Exchange: both replicas now hold `c, [u], [a deleted], [r], t` in a deterministic order. Alice's `r` still has a valid anchor (the tombstone of `a`), so it is **not lost**. Both show the same text, e.g. `curt`. The result may not be what either person *intended*, but it is **identical for both** and **loses nobody's valid edit**. That is the CRDT promise; it does not promise it reads well.

## 3. `Y.Doc` and shared types

A **`Y.Doc`** is the container of one document's shared data. It holds named *shared types*:

| Shared type | Used for |
|---|---|
| `Y.XmlFragment` (named `content`) | the rich text body: paragraphs, headings, lists as a tree of `Y.XmlElement` / `Y.XmlText` |
| `Y.Text`, `Y.Map`, `Y.Array` | not used for the body here; the tests use `Y.Text` for brevity |

Key facts to be able to state:

* **One `Y.Doc` per document**, identified by a stable UUID that all collaborators share (`new Y.Doc({ guid: id })`).
* The doc is the **source of truth**. The editor is a *view*: TipTap's Collaboration extension translates ProseMirror transactions into Yjs updates and back.
* Changes arrive as **updates** (compact binary diffs). `doc.on('update', (update, origin) => …)` fires for each. The **origin** says who caused it (the local user typing, an undo, IndexedDB loading, the network provider). The app uses origins to tell "this user edited" (bump "last edited", send "typing…") from "the network delivered something" (`frontend/src/editor/origins.ts`).
* **State vector**: a compact summary "for every client id, how many operations I have seen". Two replicas compare state vectors to compute *exactly* the updates the other lacks. `Y.encodeStateAsUpdate(doc, theirStateVector)` produces that diff.
* **Delete set**: which items are tombstones. Important detail: deleting text **changes the delete set but not the state vector**. (This is why the server's acknowledgement carries both: see §6.)

**Undo/redo** must not use ProseMirror's own history while Yjs is active: that history would undo *other people's* changes or fight the CRDT. Yjs's `UndoManager` only undoes changes whose origin is the local user. `createEditorExtensions({ history: false })` turns ProseMirror's history off.

**Conflict handling summary** (a table worth memorising):

| Situation | Outcome | Why |
|---|---|---|
| Two people type at the same spot | Both texts kept, one deterministic order | items have unique ids; ties broken by client id |
| One deletes text another is typing inside | The deleted part is gone, the new typing in surviving neighbours stays | tombstones keep neighbours valid |
| Same update delivered twice | No change | merge is idempotent |
| Updates delivered out of order | Same final state | merge is commutative; Yjs buffers an update until its predecessors arrive |
| Both rename a document title | Last write wins | a title is a single value, handled outside the CRDT (see §8) |
| Both edit the same paragraph, then someone *restores a version* | Converges; text typed into a paragraph the restore deleted is superseded | restore is a new edit; the pre-restore version still contains it |

## 4. Local persistence (IndexedDB)

* IndexedDB is the browser's built-in transactional database for structured/binary data. It survives reloads, tab closes and browser restarts, and works offline. `localStorage` is small, synchronous and string-only, so it is **not** used for documents.
* `y-indexeddb` listens to the `Y.Doc` and **appends every update** to an object store, and occasionally compacts them into one. On the next load it **replays** them into a fresh `Y.Doc`. Because updates are idempotent, replaying a few extra is harmless.
* **Ordering rule that matters:** the editor mounts, and the network provider connects, only **after** `whenSynced` (stored updates loaded). Otherwise a fast network response could arrive first, or the editor could render an empty document that is then "filled in", and a naive app might treat the empty state as real. (`hooks/useLocalDocument.ts`.)
* Local data is namespaced by user id (`localsync:<userId>:doc:<documentId>`), so another account on the same browser sees nothing.
* Failure handling: IndexedDB can fail to open (private mode) or reject writes (disk full). `y-indexeddb` would hang or silently drop, so `localDocument.ts` adds a timeout, an explicit rejection, and a listener for write failures, and the UI shows **"Not saved on this device"**. *Test:* `idbDocumentStore.test.ts` with a deliberately broken IndexedDB.

## 5. The provider and synchronisation

A **provider** is the adapter between a `Y.Doc` and a transport. Here: `y-websocket`'s `WebsocketProvider` on the client, and a server built from `y-protocols` + `ws`.

The sync protocol (Yjs "sync step 1 / 2"):

1. On connect, **each side sends its state vector** ("step 1").
2. Each replies with **exactly the updates the other lacks** ("step 2").
3. From then on, every new local update is sent immediately ("update").

Consequences you should be able to explain:

* **Offline is not a special mode.** Edits made while disconnected are simply updates in the local `Y.Doc` (and IndexedDB). Reconnecting runs step 1/2, which sends them. There is **no queue of operations to replay in order**; replaying a queue would reintroduce the ordering/duplication problems the CRDT exists to avoid.
* **Reconnecting repeatedly, or receiving updates twice, is safe.** *Tests:* five offline/online cycles with edits on both sides (no loss, no duplicates), a burst of 50 offline edits delivered exactly once, a TCP connection killed without a close frame.
* **Convergence needs no coordination**, but **the server still matters** for: finding each other, authorization, durable storage, and acknowledging that your data reached somewhere durable.

## 6. "Saved locally" versus "synced"

These are different facts and the UI keeps them apart:

* **Saved on this device**: the update was written to IndexedDB.
* **Synced**: the **server has durably stored** a state that contains everything on this device.

The server cannot just say "got it" when a message arrives; that would be a lie if the database then failed. So the server saves first, **then** sends an `Ack` containing a Yjs *snapshot* (state vector + delete set) of what it stored. The client checks that the snapshot **covers** its own document. Reasons for each detail are in [architecture.md](architecture.md#the-acknowledgement-protocol-why-synced-is-truthful). *Tests:* `durability.test.ts` (database slow → "Syncing" although collaborators already see the text; database failing → never "Synced", recovers on its own; delete-only edit; server restarted empty), plus a mutation check that makes the server ack early and confirms three tests fail.

## 7. Conflicts that a CRDT does **not** solve

A strong answer admits the limits:

* **Convergence ≠ intent.** Merged text is the same everywhere but may be semantically odd ("curt"). CRDTs avoid *lost* edits, not *surprising* ones.
* **Metadata** such as a title is a single value: last-write-wins is the right model, handled outside the CRDT.
* **Permissions and deletion** are policy, not data: a CRDT would happily merge an edit from someone who is no longer allowed to make it. The server enforces access (viewers' writes are discarded, removed users are disconnected).
* **History grows**: tombstones and per-client metadata accumulate; Yjs garbage-collects what it can, but a CRDT document is not free.
* **Restoring an old version** cannot "rewind" a CRDT (every past operation is part of its identity). It must be a **new edit** that makes the text equal the old text. Concurrent typing into a paragraph that the restore deleted is superseded; the automatic "before restore" version is the safety net.

## 8. Where this project is *not* a CRDT, and why

The document list (titles, deletions, who owns what) uses a small "outbox flag" approach with last-write-wins: `registered`, `titleDirty`, and a deletion tombstone per document, sent by an idempotent sync pass. That is deliberate: it is the only place where "queued application events" makes sense, and it never touches document bodies. A subtle bug class here is the **lost update** (rename while an upload is in flight); it is prevented with atomic read-modify-write and has a test.

## 9. Likely viva questions, with short answers

**Why a CRDT rather than the server deciding?**
Offline editing. A server-ordered model cannot merge long offline periods gracefully; a CRDT merges by construction.

**What guarantees both browsers show the same text?**
Unique ids per item + a deterministic ordering rule + idempotent, commutative merge. Any two replicas that have seen the same updates are identical.

**What exactly is sent when a client reconnects?**
Its state vector; the server answers with what the client lacks; the client answers with what the server lacks. Not a log of operations.

**Why does the editor wait for IndexedDB before connecting?**
So local state is authoritative first. An empty server response (or an empty first render) can never be mistaken for "the document is empty" and overwrite or hide local work. (With a CRDT an empty server can't actually erase content, but the UI must still not flash or mislead.)

**Why not `localStorage`?**
Synchronous, ~5 MB, strings only; IndexedDB is asynchronous, transactional, large, and stores binary updates.

**How do you know a change reached the server?**
The server's `Ack` after the database write, compared against the client's whole document, including deletions.

**What stops a viewer from editing by tampering with the page?**
The server. A viewer's sync-update messages are read and discarded before they touch the server's document; the role is read from the database on every connection. *Test:* an end-to-end test forces the editor editable in a viewer's browser and types; the owner never sees it and a fresh device never loads it.

**What happens to someone's open editor when they are removed from the document?**
The membership change closes their socket (a transient code), the client reconnects, is re-authorized, and is refused with a permanent code. Tested end to end.

**What if two people rename the same document offline?**
Last write wins for the title; content is unaffected.

**What are the weaknesses?**
Single server instance (rooms in memory), whole-state saves, comments anchored by quote not position, restore race described above, Chrome-only testing. See the README's *Known limitations*.

## 10. Glossary

* **Replica**: one copy of a document (one browser tab/device, plus the server's).
* **Update**: a binary description of changes; applying the same one twice is a no-op.
* **State vector**: "for each client id, how many of their operations I have".
* **Delete set**: the set of items marked deleted.
* **Tombstone**: a deleted item kept so concurrent edits next to it stay valid.
* **Awareness**: ephemeral presence data (cursor, name); not part of the document, never stored.
* **Origin**: who caused a Yjs transaction (user, undo, persistence, network).
* **Provider**: adapter that moves updates between a `Y.Doc` and a transport.
* **Local-first**: the device's copy is the primary one; the network improves it but is not required.
