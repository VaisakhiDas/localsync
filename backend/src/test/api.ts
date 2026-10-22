import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config';
import type { Db } from '../db/pool';
import { silentLogger } from '../logger';
import { createPgAuthorizer } from '../realtime/pgAuthorizer';
import { createPgPersistence } from '../realtime/pgPersistence';
import { startServer } from '../server';
import { ORIGIN, type TestServer } from './harness';

export interface ApiServer extends TestServer {
  httpUrl: string;
}

/** The real application (HTTP API + WebSocket) wired to a real PostgreSQL. */
export async function startApiServer(db: Db, env: Record<string, string> = {}): Promise<ApiServer> {
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    ALLOWED_ORIGINS: ORIGIN,
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused',
    SCRYPT_COST: '1024', // fast hashing, tests only
    AUTH_RATE_LIMIT_MAX: '1000',
    PERSIST_DEBOUNCE_MS: '20',
    PERSIST_MAX_WAIT_MS: '200',
    ROOM_IDLE_MS: '60',
    SHUTDOWN_TIMEOUT_MS: '3000',
    ...env,
  });
  const persistence = createPgPersistence(db, silentLogger, { autoVersionIntervalMs: config.AUTO_VERSION_INTERVAL_MS, autoVersionsKept: config.AUTO_VERSIONS_KEPT });
  const running = await startServer({ config, log: silentLogger, db, authorizer: createPgAuthorizer(db), persistence });
  return { ...running, persistence, url: `ws://127.0.0.1:${running.port}`, httpUrl: `http://127.0.0.1:${running.port}` };
}

export interface ApiResponse<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
  body: T;
  setCookie: string[];
}

/** A tiny browser: keeps the session cookie between requests and sends a trusted Origin like a real page does. */
export class ApiClient {
  cookie = '';
  constructor(
    private readonly baseUrl: string,
    private readonly origin: string | null = ORIGIN,
  ) {}

  async request<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResponse<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined && !('content-type' in headers)) headers['content-type'] = 'application/json';
    if (this.origin) headers.origin = this.origin;
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie();
    for (const header of setCookie) {
      const [pair = ''] = header.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (name.trim() === 'ls_session') this.cookie = value === '' ? '' : pair.trim();
    }
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, setCookie };
  }
  get = <T = any>(path: string) => this.request<T>('GET', path); // eslint-disable-line @typescript-eslint/no-explicit-any
  post = <T = any>(path: string, body?: unknown) => this.request<T>('POST', path, body ?? {}); // eslint-disable-line @typescript-eslint/no-explicit-any
  put = <T = any>(path: string, body?: unknown) => this.request<T>('PUT', path, body ?? {}); // eslint-disable-line @typescript-eslint/no-explicit-any
  patch = <T = any>(path: string, body?: unknown) => this.request<T>('PATCH', path, body ?? {}); // eslint-disable-line @typescript-eslint/no-explicit-any
  delete = <T = any>(path: string) => this.request<T>('DELETE', path); // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const PASSWORD = 'correct horse battery staple';

/** Registers a user and returns a client that is signed in as them. */
export async function signUp(server: ApiServer, name: string, email = `${name.toLowerCase()}@example.com`) {
  const api = new ApiClient(server.httpUrl);
  const res = await api.post('/api/auth/register', { email, displayName: name, password: PASSWORD });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { api, user: res.body.user as { id: string; email: string; displayName: string } };
}

export const newDocumentId = () => randomUUID();
