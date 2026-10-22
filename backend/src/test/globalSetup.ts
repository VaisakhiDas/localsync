import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { startEmbeddedPostgres } from '../db/embedded';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the shared test PostgreSQL (admin database). */
    pgUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** One real PostgreSQL for the whole test run; each test file gets its own database inside it. */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'localsync-pg-'));
  const pg = await startEmbeddedPostgres({ dataDir: dir, port: await freePort(), persistent: false });
  project.provide('pgUrl', pg.url);
  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}
