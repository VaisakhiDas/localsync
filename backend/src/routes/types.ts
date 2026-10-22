import type { Config } from '../config';
import type { Db } from '../db/pool';
import type { Logger } from '../logger';
import type { RealtimeServer } from '../realtime/server';

/** The slice of the realtime server that HTTP routes may use. */
export type RealtimeControl = Pick<RealtimeServer, 'disconnectUser' | 'disconnectSession' | 'closeDocument' | 'withDocument'>;

export interface RouteDeps {
  db: Db;
  config: Config;
  log: Logger;
  realtime: RealtimeControl;
}
