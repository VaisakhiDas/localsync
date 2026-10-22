import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../test/db';
import { ApiClient, PASSWORD, signUp, startApiServer, type ApiServer } from '../test/api';
import type { Db } from '../db/pool';

describe('accounts and sessions', () => {
  let server: ApiServer;
  let db: Db;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDatabase());
    server = await startApiServer(db);
  });
  afterAll(async () => {
    await server.close();
    await drop();
  });

  it('registers a user, signs them in with an HttpOnly SameSite cookie, and never returns secrets', async () => {
    const api = new ApiClient(server.httpUrl);
    const res = await api.post('/api/auth/register', { email: 'Ada@Example.COM ', displayName: '  Ada   Lovelace ', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', displayName: 'Ada Lovelace' }); // normalised
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);

    const cookie = res.setCookie.find((c) => c.startsWith('ls_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i); // tests run over http; production sets it (see below)
    expect((await api.get('/api/auth/me')).body.user.email).toBe('ada@example.com');
  });

  it('stores a scrypt hash, never the password, and only a hash of the session token', async () => {
    const { api, user } = await signUp(server, 'Grace');
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(rows[0]!.password_hash).not.toContain(PASSWORD);

    const token = api.cookie.split('=')[1]!;
    const sessions = await db.query<{ token_hash: Buffer }>('SELECT token_hash FROM sessions WHERE user_id = $1', [user.id]);
    expect(sessions.rows[0]!.token_hash.toString('utf8')).not.toContain(token);
    expect(sessions.rows[0]!.token_hash.length).toBe(32); // SHA-256
  });

  it('marks the cookie Secure when configured (production default)', async () => {
    const secure = await startApiServer(db, { COOKIE_SECURE: 'true' });
    try {
      const res = await new ApiClient(secure.httpUrl).post('/api/auth/register', { email: 'sec@example.com', displayName: 'Sec', password: PASSWORD });
      expect(res.setCookie.find((c) => c.startsWith('ls_session='))).toMatch(/Secure/i);
    } finally {
      await secure.close();
    }
  });

  it('validates registration input and names the bad fields', async () => {
    const api = new ApiClient(server.httpUrl);
    const res = await api.post('/api/auth/register', { email: 'not-an-email', displayName: '   ', password: 'short' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['displayName', 'email', 'password']);
    expect((await api.post('/api/auth/register', {})).status).toBe(400);
    expect((await api.post('/api/auth/register', { email: 'a@b.co', displayName: 'x', password: 'x'.repeat(129) })).status).toBe(400);
  });

  it('rejects a duplicate email, ignoring case', async () => {
    await signUp(server, 'Dup', 'dup@example.com');
    const res = await new ApiClient(server.httpUrl).post('/api/auth/register', { email: 'DUP@example.com', displayName: 'Other', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('login: right password works; wrong password and unknown email give the SAME response', async () => {
    await signUp(server, 'Login', 'login@example.com');
    const ok = await new ApiClient(server.httpUrl).post('/api/auth/login', { email: 'LOGIN@example.com', password: PASSWORD });
    expect(ok.status).toBe(200);

    const wrongPassword = await new ApiClient(server.httpUrl).post('/api/auth/login', { email: 'login@example.com', password: 'wrong wrong wrong' });
    const unknownEmail = await new ApiClient(server.httpUrl).post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong wrong wrong' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body); // no account enumeration through login
    expect(wrongPassword.setCookie).toEqual([]);
  });

  it('issues a fresh session on every login (no session fixation)', async () => {
    await signUp(server, 'Fix', 'fix@example.com');
    const a = new ApiClient(server.httpUrl);
    const b = new ApiClient(server.httpUrl);
    await a.post('/api/auth/login', { email: 'fix@example.com', password: PASSWORD });
    await b.post('/api/auth/login', { email: 'fix@example.com', password: PASSWORD });
    expect(a.cookie).not.toBe(b.cookie);
    // A planted cookie value is not adopted either.
    const attacker = new ApiClient(server.httpUrl);
    attacker.cookie = 'ls_session=attacker-chosen-value';
    const res = await attacker.post('/api/auth/login', { email: 'fix@example.com', password: PASSWORD });
    expect(res.setCookie.find((c) => c.startsWith('ls_session='))).not.toContain('attacker-chosen-value');
  });

  it('logout revokes the session server-side: the old cookie stops working', async () => {
    const { api } = await signUp(server, 'Out', 'out@example.com');
    const stolen = api.cookie;
    expect((await api.post('/api/auth/logout')).status).toBe(204);
    expect(api.cookie).toBe(''); // cleared in the browser...
    const replay = new ApiClient(server.httpUrl);
    replay.cookie = stolen; // ...and useless even if someone kept a copy
    expect((await replay.get('/api/auth/me')).status).toBe(401);
  });

  it('expired sessions are refused', async () => {
    const { api, user } = await signUp(server, 'Exp', 'exp@example.com');
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [user.id]);
    expect((await api.get('/api/auth/me')).status).toBe(401);
  });

  it('protected endpoints require a session', async () => {
    const anonymous = new ApiClient(server.httpUrl);
    expect((await anonymous.get('/api/documents')).status).toBe(401);
    expect((await anonymous.get('/api/auth/me')).status).toBe(401);
  });

  it('refuses state-changing requests from an untrusted Origin (CSRF), but not from the real front-end', async () => {
    const { api } = await signUp(server, 'Csrf', 'csrf@example.com');
    const evil = new ApiClient(server.httpUrl, 'http://evil.example');
    evil.cookie = api.cookie; // the browser would attach the cookie ambiently
    const attack = await evil.post('/api/auth/logout');
    expect(attack.status).toBe(403);
    expect((await api.get('/api/auth/me')).status).toBe(200); // still signed in: the forged logout did nothing
  });

  it('only accepts JSON bodies and answers clearly to malformed or oversized ones', async () => {
    const api = new ApiClient(server.httpUrl);
    const form = await api.request('POST', '/api/auth/login', 'email=a%40b.co&password=x', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(400);
    const broken = await api.request('POST', '/api/auth/login', '{"email": ', { 'content-type': 'application/json' });
    expect(broken.status).toBe(400);
    expect(broken.body.error).toBe('invalid_json');
    const huge = await api.request('POST', '/api/auth/login', JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }), { 'content-type': 'application/json' });
    expect(huge.status).toBe(413);
  });

  it('treats SQL metacharacters as plain data', async () => {
    const api = new ApiClient(server.httpUrl);
    const nasty = "x'; DROP TABLE users; --";
    const res = await api.post('/api/auth/login', { email: `${nasty}@example.com`, password: nasty });
    expect([400, 401]).toContain(res.status); // rejected as input or as credentials, never a 500
    expect((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBeGreaterThan(0); // table intact
  });

  it('rate-limits repeated authentication attempts', async () => {
    const limited = await startApiServer(db, { AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const api = new ApiClient(limited.httpUrl);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await api.post('/api/auth/login', { email: 'a@b.co', password: 'nope nope nope' })).status);
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('does not leak internals on unknown routes or server errors', async () => {
    const api = new ApiClient(server.httpUrl);
    const res = await api.get('/api/nope');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|stack|pg_/i);
  });

  it('reports database health', async () => {
    const res = await new ApiClient(server.httpUrl).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
