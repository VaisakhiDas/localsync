import { canDelete, canEdit, canManageMembers, changeRoleSchema, createDocumentSchema, inviteMemberSchema, isDocumentId, renameDocumentSchema, type Role } from '@localsync/shared';
import { Router, type Request } from 'express';
import { authOf, requireAuth } from '../middleware/auth';
import { conflict, forbidden, notFound } from '../middleware/errors';
import { parse } from '../middleware/validate';
import {
  deleteDocument,
  ensureDocument,
  getDocument,
  getRole,
  listDocuments,
  listMembers,
  removeMember,
  renameDocument,
  upsertMember,
} from '../services/documents';
import { findUserByEmail } from '../services/users';
import type { RouteDeps } from './types';

export function documentsRouter({ db, realtime }: RouteDeps): Router {
  const router = Router();
  router.use(requireAuth);

  /** `:id` must be a UUID; anything else is "not found" without touching the database. */
  const documentIdOf = (req: Request): string => {
    const id = req.params.id;
    if (!isDocumentId(id)) throw notFound();
    return id;
  };

  /**
   * The caller's role on this document, taken from the DATABASE. A non-member gets 404, the same
   * answer as a document that does not exist, so ids cannot be probed.
   */
  async function roleOf(req: Request, documentId: string): Promise<Role> {
    const role = await getRole(db, authOf(req).user.id, documentId);
    if (!role) throw notFound();
    return role;
  }

  router.get('/', async (req, res) => {
    res.json({ documents: await listDocuments(db, authOf(req).user.id) });
  });

  // Create-or-confirm with a client-generated id: a document made offline is registered later,
  // and a retried request after a dropped connection is harmless.
  router.put('/:id', async (req, res) => {
    const id = documentIdOf(req);
    const { title } = parse(createDocumentSchema, req.body);
    const userId = authOf(req).user.id;
    const outcome = await ensureDocument(db, userId, id, title);
    if (outcome === 'taken') throw forbidden(); // someone else's id: say nothing about whose or what
    res.status(outcome === 'created' ? 201 : 200).json({ document: await getDocument(db, userId, id) });
  });

  router.get('/:id', async (req, res) => {
    const document = await getDocument(db, authOf(req).user.id, documentIdOf(req));
    if (!document) throw notFound();
    res.json({ document });
  });

  router.patch('/:id', async (req, res) => {
    const id = documentIdOf(req);
    if (!canEdit(await roleOf(req, id))) throw forbidden('Viewers cannot rename documents.');
    await renameDocument(db, id, parse(renameDocumentSchema, req.body).title);
    res.json({ document: await getDocument(db, authOf(req).user.id, id) });
  });

  router.delete('/:id', async (req, res) => {
    const id = documentIdOf(req);
    if (!canDelete(await roleOf(req, id))) throw forbidden('Only the owner can delete a document.');
    await deleteDocument(db, id);
    realtime.closeDocument(id);
    res.status(204).end();
  });

  // --- sharing ---------------------------------------------------------------

  router.get('/:id/members', async (req, res) => {
    const id = documentIdOf(req);
    await roleOf(req, id);
    res.json({ members: await listMembers(db, id) });
  });

  router.post('/:id/members', async (req, res) => {
    const id = documentIdOf(req);
    if (!canManageMembers(await roleOf(req, id))) throw forbidden('Only the owner can share this document.');
    const { email, role } = parse(inviteMemberSchema, req.body);
    const target = await findUserByEmail(db, email);
    if (!target) throw notFound('No account uses that email address.');
    if (target.id === authOf(req).user.id) throw conflict('already_owner', 'You already own this document.');
    await upsertMember(db, id, target.id, role);
    realtime.disconnectUser(id, target.id); // reconnect and be re-authorised with the new role
    res.status(201).json({ members: await listMembers(db, id) });
  });

  router.patch('/:id/members/:userId', async (req, res) => {
    const id = documentIdOf(req);
    if (!canManageMembers(await roleOf(req, id))) throw forbidden('Only the owner can change roles.');
    const userId = req.params.userId;
    if (!isDocumentId(userId)) throw notFound();
    const members = await listMembers(db, id);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw notFound();
    if (target.role === 'owner') throw forbidden('The owner role cannot be changed.');
    await upsertMember(db, id, userId, parse(changeRoleSchema, req.body).role);
    realtime.disconnectUser(id, userId);
    res.json({ members: await listMembers(db, id) });
  });

  router.delete('/:id/members/:userId', async (req, res) => {
    const id = documentIdOf(req);
    const role = await roleOf(req, id);
    const userId = req.params.userId;
    if (!isDocumentId(userId)) throw notFound();
    const leaving = userId === authOf(req).user.id;
    if (!leaving && !canManageMembers(role)) throw forbidden('Only the owner can remove people.');
    const target = (await listMembers(db, id)).find((m) => m.userId === userId);
    if (!target) throw notFound();
    if (target.role === 'owner') throw forbidden('The owner cannot be removed. Delete the document instead.');
    await removeMember(db, id, userId);
    realtime.disconnectUser(id, userId);
    res.status(204).end();
  });

  return router;
}
