import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app';
import type { Config } from './config';
import type { Db } from './db/pool';
import type { Logger } from './logger';
import { createRealtimeServer, type RealtimeServer } from './realtime/server';
import type { Authorizer, DocumentPersistence } from './realtime/types';

export interface ServerDeps {
  config: Config;
  log: Logger;
  authorizer: Authorizer;
  persistence: DocumentPersistence;
  /** Enables the account and document API. Omit for realtime-only use (tests). */
  db?: Db;
  allowMissingOrigin?: boolean;
}

export interface RunningServer {
  http: http.Server;
  realtime: RealtimeServer;
  /** The port actually bound (useful when PORT=0). */
  port: number;
  /** Graceful shutdown. Safe to call more than once. */
  close(): Promise<void>;
}

/** Starts HTTP + WebSocket on `config.HOST:config.PORT`. Used by the real entry point and by tests. */
export async function startServer(deps: ServerDeps): Promise<RunningServer> {
  const { config, log } = deps;
  const realtime = createRealtimeServer({
    authorizer: deps.authorizer,
    persistence: deps.persistence,
    config,
    log,
    allowMissingOrigin: deps.allowMissingOrigin,
  });
  const server = http.createServer(createApp({ config, log, db: deps.db, realtime }));
  server.on('upgrade', (req, socket, head) => realtime.handleUpgrade(req, socket, head));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, config.HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  log.info('server listening', { host: config.HOST, port });

  let closing: Promise<void> | null = null;
  return {
    http: server,
    realtime,
    port,
    close() {
      closing ??= (async () => {
        // Order matters: persist documents and close sockets first, then stop HTTP.
        await realtime.close();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        log.info('server stopped');
      })();
      return closing;
    },
  };
}
