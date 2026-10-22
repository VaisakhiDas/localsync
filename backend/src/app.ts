import express from 'express';
import helmet from 'helmet';
import type { Config } from './config';
import type { Db } from './db/pool';
import { errorFields, type Logger } from './logger';
import { loadSession } from './middleware/auth';
import { apiNotFound, createErrorHandler } from './middleware/errors';
import { requireTrustedOrigin } from './middleware/trustedOrigin';
import { authRouter } from './routes/auth';
import { commentsRouter } from './routes/comments';
import { documentsRouter } from './routes/documents';
import { versionsRouter } from './routes/versions';
import type { RealtimeControl } from './routes/types';

export interface AppDeps {
  config: Config;
  log: Logger;
  /** Without a database only /api/health is served (realtime-only tests). */
  db?: Db;
  realtime: RealtimeControl;
}

export function createApp({ config, log, db, realtime }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet()); // nosniff, frameguard, HSTS (on HTTPS), referrer policy, ...
  // Only JSON, only small: forms from other sites cannot send application/json, and a 100 kB cap stops body floods.
  app.use(express.json({ limit: '100kb' }));
  app.use(requireTrustedOrigin(config.ALLOWED_ORIGINS));

  app.get('/api/health', async (_req, res) => {
    try {
      await db?.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (err) {
      log.error('health check failed', errorFields(err));
      res.status(503).json({ status: 'unavailable' });
    }
  });

  if (db) {
    const deps = { db, config, log, realtime };
    app.use(loadSession(db));
    app.use('/api/auth', authRouter(deps));
    app.use('/api/documents', documentsRouter(deps));
    app.use('/api/documents/:id/versions', versionsRouter(deps));
    app.use('/api/documents/:id/comments', commentsRouter(deps));
  }

  app.use('/api', apiNotFound);
  app.use(createErrorHandler(log));
  return app;
}
