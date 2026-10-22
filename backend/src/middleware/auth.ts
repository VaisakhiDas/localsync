import { parse as parseCookie } from 'cookie';
import type { RequestHandler } from 'express';
import type { Db } from '../db/pool';
import { findSession, SESSION_COOKIE, type AuthContext } from '../services/sessions';
import { unauthorized } from './errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by loadSession when a valid session cookie is present. Never populated from the request body. */
      auth?: AuthContext;
    }
  }
}

/** Resolves the session cookie (if any) to a user. Identity ONLY ever comes from here. */
export function loadSession(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
    if (token) req.auth = (await findSession(db, token)) ?? undefined;
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next();
};

/** For handlers behind requireAuth: the authenticated context, typed non-null. */
export const authOf = (req: Express.Request): AuthContext => {
  if (!req.auth) throw unauthorized();
  return req.auth;
};
