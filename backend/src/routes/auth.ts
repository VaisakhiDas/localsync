import { loginSchema, registerSchema, type ApiErrorBody, type UserDto } from '@localsync/shared';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { parse } from '../middleware/validate';
import { createSession, deleteSession, SESSION_COOKIE } from '../services/sessions';
import { authenticate, createUser } from '../services/users';
import type { RouteDeps } from './types';

export function authRouter({ db, config, realtime }: RouteDeps): Router {
  const router = Router();

  // Brute-force and credential-stuffing brake. Counted per client IP (set TRUST_PROXY behind a proxy).
  const limiter = rateLimit({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' } satisfies ApiErrorBody);
    },
  });

  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' } as const;

  async function signIn(req: Request, res: Response, user: UserDto) {
    // A fresh session id on every login: an attacker-planted cookie value is never adopted (no session fixation).
    const { token, expiresAt } = await createSession(db, user.id, config.SESSION_TTL_DAYS, req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
  }

  router.post('/register', limiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    const user = await createUser(db, input, config.SCRYPT_COST);
    await signIn(req, res, user);
    res.status(201).json({ user });
  });

  router.post('/login', limiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await authenticate(db, input.email, input.password, config.SCRYPT_COST);
    if (!user) {
      // One message for "no such account" and "wrong password".
      res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' } satisfies ApiErrorBody);
      return;
    }
    await signIn(req, res, user);
    res.json({ user });
  });

  router.post('/logout', async (req, res) => {
    if (req.auth) {
      await deleteSession(db, req.auth.sessionId);
      realtime.disconnectSession(req.auth.sessionId);
    }
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthenticated', message: 'Not signed in.' } satisfies ApiErrorBody);
      return;
    }
    res.json({ user: req.auth.user });
  });

  return router;
}
