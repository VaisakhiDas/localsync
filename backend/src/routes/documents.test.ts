import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/pool';
import { ApiClient, newDocumentId, signUp, startApiServer, type ApiServer } from '../test/api';
import { createTestDatabase } from '../test/db';

/**
 * Authorisation matrix. Four people, one document:
 *   owner (alice) / editor (bob) / viewer (vera) / stranger (sam, no membership at all).
 * The role always comes from the database, never from anything the client sends.
 */
describe('document API authorisation', () => {
  let server: ApiServer;
  let db: Db;
  let drop: () => Promise<void>;
  let alice: ApiClient, bob: ApiClient, vera: ApiClient, sam: ApiClient;
  let users: Record<'alice' | 'bob' | 'vera' | 'sam', { id: string; email: string }>;
  let anonymous: ApiClient;

  const newSharedDoc = async (title = 'Plan') => {
    const id = newDocumentId();
    expect((await alice.put(`/api/documents/${id}`, { title })).status).toBe(201);
    expect((await alice.post(`/api/documents/${id}/members`, { email: users.bob.email, role: 'editor' })).status).toBe(201);
    expect((await alice.post(`/api/documents/${id}/members`, { email: users.vera.email, role: 'viewer' })).status).toBe(201);
    return id;
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase());
    server = await startApiServer(db);
    const [a, b, v, s] = await Promise.all(['Alice', 'Bob', 'Vera', 'Sam'].map((n) => signUp(server, n)));
    alice = a!.api; bob = b!.api; vera = v!.api; sam = s!.api;
    users = { alice: a!.user, bob: b!.user, vera: v!.user, sam: s!.user };
    anonymous = new ApiClient(server.httpUrl);
  });
  afterAll(async () => {
    await server.close();
    await drop();
  });

  describe('creating documents', () => {
    it('creates with a client-chosen id, owned by the caller, and is idempotent for a retry', async () => {
      const id = newDocumentId();
      const first = await alice.put(`/api/documents/${id}`, { title: '  Offline   draft ' });
      expect(first.status).toBe(201);
      expect(first.body.document).toMatchObject({ id, title: 'Offline draft', role: 'owner', ownerName: 'Alice' });
      const retry = await alice.put(`/api/documents/${id}`, { title: 'Offline draft' });
      expect(retry.status).toBe(200); // a dropped connection followed by a retry is harmless
      expect((await alice.get('/api/documents')).body.documents.filter((d: { id: string }) => d.id === id)).toHaveLength(1);
    });

    it("refuses to adopt someone else's id, and says nothing about whose it is", async () => {
      const id = newDocumentId();
      await alice.put(`/api/documents/${id}`, { title: 'Mine' });
      const res = await sam.put(`/api/documents/${id}`, { title: 'Hijack' });
      expect(res.status).toBe(403);
      expect((await alice.get(`/api/documents/${id}`)).body.document.title).toBe('Mine');
    });

    it('ignores identity and role fields smuggled into the body', async () => {
      const id = newDocumentId();
      const res = await sam.put(`/api/documents/${id}`, { title: 'Sneaky', ownerId: users.alice.id, userId: users.alice.id, role: 'viewer' });
      expect(res.status).toBe(201);
      expect(res.body.document.role).toBe('owner');
      const owner = await db.query("SELECT user_id FROM document_members WHERE document_id = $1 AND role = 'owner'", [id]);
      expect(owner.rows).toEqual([{ user_id: users.sam.id }]); // the authenticated caller, nobody else
    });

    it.each(['not-a-uuid', '123', '../etc/passwd', 'null'])('rejects the malformed id %j as "not found" without touching data', async (id) => {
      expect((await alice.put(`/api/documents/${encodeURIComponent(id)}`, { title: 'x' })).status).toBe(404);
    });

    it('validates the title', async () => {
      const id = newDocumentId();
      expect((await alice.put(`/api/documents/${id}`, {})).status).toBe(400);
      expect((await alice.put(`/api/documents/${id}`, { title: '   ' })).status).toBe(400);
      expect((await alice.put(`/api/documents/${id}`, { title: 'x'.repeat(201) })).status).toBe(400);
    });
  });

  describe('reading', () => {
    it('lists only documents the caller is a member of', async () => {
      const id = await newSharedDoc('Visible to three');
      const ids = async (c: ApiClient) => (await c.get('/api/documents')).body.documents.map((d: { id: string }) => d.id);
      expect(await ids(alice)).toContain(id);
      expect(await ids(bob)).toContain(id);
      expect(await ids(vera)).toContain(id);
      expect(await ids(sam)).not.toContain(id);
      const bobsView = (await bob.get('/api/documents')).body.documents.find((d: { id: string }) => d.id === id);
      expect(bobsView).toMatchObject({ role: 'editor', ownerName: 'Alice' });
    });

    it('a stranger gets the SAME answer for a real document as for one that does not exist (no probing)', async () => {
      const id = await newSharedDoc();
      const real = await sam.get(`/api/documents/${id}`);
      const fake = await sam.get(`/api/documents/${newDocumentId()}`);
      expect(real.status).toBe(404);
      expect(fake.status).toBe(404);
      expect(real.body).toEqual(fake.body);
    });

    it('requires a session for everything', async () => {
      const id = await newSharedDoc();
      for (const [method, path] of [
        ['GET', '/api/documents'],
        ['GET', `/api/documents/${id}`],
        ['PUT', `/api/documents/${id}`],
        ['PATCH', `/api/documents/${id}`],
        ['DELETE', `/api/documents/${id}`],
        ['GET', `/api/documents/${id}/members`],
        ['POST', `/api/documents/${id}/members`],
      ] as const) {
        expect((await anonymous.request(method, path, method === 'GET' || method === 'DELETE' ? undefined : { title: 'x' })).status, `${method} ${path}`).toBe(401);
      }
    });
  });

  describe('renaming and deleting', () => {
    it('owner and editor may rename; viewer may not; stranger sees nothing', async () => {
      const id = await newSharedDoc();
      expect((await alice.patch(`/api/documents/${id}`, { title: 'By owner' })).body.document.title).toBe('By owner');
      expect((await bob.patch(`/api/documents/${id}`, { title: 'By editor' })).body.document.title).toBe('By editor');
      expect((await vera.patch(`/api/documents/${id}`, { title: 'By viewer' })).status).toBe(403);
      expect((await sam.patch(`/api/documents/${id}`, { title: 'By stranger' })).status).toBe(404);
      expect((await alice.get(`/api/documents/${id}`)).body.document.title).toBe('By editor');
    });

    it('only the owner may delete, and deletion removes members and content too', async () => {
      const id = await newSharedDoc();
      await db.query("INSERT INTO document_states (document_id, state) VALUES ($1, '\\x00')", [id]);
      expect((await bob.delete(`/api/documents/${id}`)).status).toBe(403);
      expect((await vera.delete(`/api/documents/${id}`)).status).toBe(403);
      expect((await sam.delete(`/api/documents/${id}`)).status).toBe(404);
      expect((await alice.get(`/api/documents/${id}`)).status).toBe(200); // all of the above changed nothing

      expect((await alice.delete(`/api/documents/${id}`)).status).toBe(204);
      expect((await alice.get(`/api/documents/${id}`)).status).toBe(404);
      expect((await bob.get(`/api/documents/${id}`)).status).toBe(404);
      for (const table of ['document_members', 'document_states', 'documents']) {
        const col = table === 'documents' ? 'id' : 'document_id';
        expect((await db.query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [id])).rowCount).toBe(0);
      }
    });
  });

  describe('sharing', () => {
    it('lets every member see who has access, and nobody else', async () => {
      const id = await newSharedDoc();
      for (const member of [alice, bob, vera]) {
        const members = (await member.get(`/api/documents/${id}/members`)).body.members;
        expect(members.map((m: { role: string }) => m.role)).toEqual(['owner', 'editor', 'viewer']);
      }
      expect((await sam.get(`/api/documents/${id}/members`)).status).toBe(404);
    });

    it('only the owner can invite, change roles or remove others', async () => {
      const id = await newSharedDoc();
      expect((await bob.post(`/api/documents/${id}/members`, { email: users.sam.email, role: 'viewer' })).status).toBe(403);
      expect((await vera.post(`/api/documents/${id}/members`, { email: users.sam.email, role: 'editor' })).status).toBe(403);
      expect((await sam.post(`/api/documents/${id}/members`, { email: users.sam.email, role: 'editor' })).status).toBe(404);
      expect((await bob.patch(`/api/documents/${id}/members/${users.vera.id}`, { role: 'editor' })).status).toBe(403);
      expect((await bob.delete(`/api/documents/${id}/members/${users.vera.id}`)).status).toBe(403);
      expect((await sam.get(`/api/documents/${id}`)).status).toBe(404); // none of that gave sam access
    });

    it('invites by email, validates the role, and handles unknown users and self-invites', async () => {
      const id = newDocumentId();
      await alice.put(`/api/documents/${id}`, { title: 'Invites' });
      expect((await alice.post(`/api/documents/${id}/members`, { email: 'nobody@example.com', role: 'editor' })).status).toBe(404);
      expect((await alice.post(`/api/documents/${id}/members`, { email: users.alice.email, role: 'editor' })).status).toBe(409);
      expect((await alice.post(`/api/documents/${id}/members`, { email: users.sam.email, role: 'owner' })).status).toBe(400); // owner cannot be granted
      expect((await alice.post(`/api/documents/${id}/members`, { email: 'garbage', role: 'editor' })).status).toBe(400);
      const ok = await alice.post(`/api/documents/${id}/members`, { email: users.sam.email.toUpperCase(), role: 'viewer' });
      expect(ok.status).toBe(201);
      expect((await sam.get(`/api/documents/${id}`)).body.document.role).toBe('viewer');
    });

    it('changing a role takes effect immediately; the owner role can never be changed or removed', async () => {
      const id = await newSharedDoc();
      expect((await vera.patch(`/api/documents/${id}`, { title: 'x' })).status).toBe(403);
      expect((await alice.patch(`/api/documents/${id}/members/${users.vera.id}`, { role: 'editor' })).status).toBe(200);
      expect((await vera.patch(`/api/documents/${id}`, { title: 'Now an editor' })).status).toBe(200);
      expect((await alice.patch(`/api/documents/${id}/members/${users.vera.id}`, { role: 'owner' })).status).toBe(400);
      expect((await alice.patch(`/api/documents/${id}/members/${users.alice.id}`, { role: 'viewer' })).status).toBe(403);
      expect((await alice.delete(`/api/documents/${id}/members/${users.alice.id}`)).status).toBe(403);
      expect((await alice.patch(`/api/documents/${id}/members/${users.sam.id}`, { role: 'viewer' })).status).toBe(404); // not a member
    });

    it('removing a member revokes access at once, and a member can leave on their own', async () => {
      const id = await newSharedDoc();
      expect((await alice.delete(`/api/documents/${id}/members/${users.bob.id}`)).status).toBe(204);
      expect((await bob.get(`/api/documents/${id}`)).status).toBe(404);
      expect((await bob.patch(`/api/documents/${id}`, { title: 'still here?' })).status).toBe(404);

      expect((await vera.delete(`/api/documents/${id}/members/${users.vera.id}`)).status).toBe(204); // leaving
      expect((await vera.get(`/api/documents/${id}`)).status).toBe(404);
    });

    it('the database guarantees exactly one owner per document', async () => {
      const id = await newSharedDoc();
      await expect(db.query("INSERT INTO document_members (document_id, user_id, role) VALUES ($1, $2, 'owner')", [id, users.sam.id])).rejects.toThrow(/one_owner/);
    });
  });
});
