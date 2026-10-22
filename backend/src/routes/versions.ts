import { canContribute, createVersionSchema, isDocumentId } from '@localsync/shared';
import { Router, type Request } from 'express';
import * as Y from 'yjs';
import { requireAuth, authOf } from '../middleware/auth';
import { forbidden, notFound } from '../middleware/errors';
import { parse } from '../middleware/validate';
import { getRole } from '../services/documents';
import { createManualVersion, getVersionState, listVersions } from '../services/versions';
import type { RouteDeps } from './types';

export function versionsRouter({ db, realtime }: RouteDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const documentIdOf = (req: Request): string => {
    const id = req.params.id;
    if (typeof id !== 'string' || !isDocumentId(id)) throw notFound();
    return id;
  };
  const roleOf = async (req: Request, id: string) => {
    const role = await getRole(db, authOf(req).user.id, id);
    if (!role) throw notFound(); // non-members cannot tell this document exists
    return role;
  };

  router.get('/', async (req, res) => {
    const id = documentIdOf(req);
    await roleOf(req, id);
    res.json({ versions: await listVersions(db, id) });
  });

  // Save a version: the SERVER freezes its own merged state (the one every collaborator has converged on).
  router.post('/', async (req, res) => {
    const id = documentIdOf(req);
    if (!canContribute(await roleOf(req, id))) throw forbidden('Viewers cannot save versions.');
    const { label } = parse(createVersionSchema, req.body);
    const state = await realtime.withDocument(id, (doc) => Y.encodeStateAsUpdate(doc));
    res.status(201).json({ version: await createManualVersion(db, id, authOf(req).user.id, label, state) });
  });

  // The frozen state, for previewing and restoring. Any member may read history; only contributors restore.
  router.get('/:versionId/state', async (req, res) => {
    const id = documentIdOf(req);
    await roleOf(req, id);
    const versionId = req.params.versionId;
    if (typeof versionId !== 'string' || !isDocumentId(versionId)) throw notFound();
    const state = await getVersionState(db, id, versionId);
    if (!state) throw notFound();
    res.type('application/octet-stream').send(state);
  });

  return router;
}
