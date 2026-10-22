import { canContribute, canManageMembers, createCommentSchema, isDocumentId } from '@localsync/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { forbidden, notFound } from '../middleware/errors';
import { parse } from '../middleware/validate';
import { createComment, deleteComment, getComment, listComments, setResolved } from '../services/comments';
import { getRole } from '../services/documents';
import type { RouteDeps } from './types';

export function commentsRouter({ db }: RouteDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const uuidParam = (req: Request, name: string): string => {
    const value = req.params[name];
    if (typeof value !== 'string' || !isDocumentId(value)) throw notFound();
    return value;
  };
  const roleOf = async (req: Request, documentId: string) => {
    const role = await getRole(db, authOf(req).user.id, documentId);
    if (!role) throw notFound();
    return role;
  };

  router.get('/', async (req, res) => {
    const id = uuidParam(req, 'id');
    await roleOf(req, id);
    res.json({ comments: await listComments(db, id) });
  });

  router.post('/', async (req, res) => {
    const id = uuidParam(req, 'id');
    if (!canContribute(await roleOf(req, id))) throw forbidden('Viewers can read comments but not write them.');
    const { body, quote } = parse(createCommentSchema, req.body);
    res.status(201).json({ comment: await createComment(db, id, authOf(req).user.id, body, quote) });
  });

  // Any contributor may resolve or reopen a thread.
  router.patch('/:commentId', async (req, res) => {
    const id = uuidParam(req, 'id');
    if (!canContribute(await roleOf(req, id))) throw forbidden('Viewers cannot resolve comments.');
    const commentId = uuidParam(req, 'commentId');
    const { resolved } = parse(z.object({ resolved: z.boolean() }), req.body);
    if (!(await getComment(db, id, commentId))) throw notFound();
    await setResolved(db, id, commentId, resolved);
    res.json({ comment: await getComment(db, id, commentId) });
  });

  // Authors may delete their own comments; the owner may delete any (moderation).
  router.delete('/:commentId', async (req, res) => {
    const id = uuidParam(req, 'id');
    const role = await roleOf(req, id);
    const commentId = uuidParam(req, 'commentId');
    const comment = await getComment(db, id, commentId);
    if (!comment) throw notFound();
    if (comment.authorId !== authOf(req).user.id && !canManageMembers(role)) throw forbidden('You can only delete your own comments.');
    await deleteComment(db, id, commentId);
    res.status(204).end();
  });

  return router;
}
