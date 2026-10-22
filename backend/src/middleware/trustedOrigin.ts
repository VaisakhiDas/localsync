import type { RequestHandler } from 'express';
import { forbidden } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie authentication, in three layers:
 *   1. the session cookie is SameSite=Lax (not sent on cross-site POST/PUT/PATCH/DELETE);
 *   2. this check: a state-changing request carrying an Origin we do not recognise is refused;
 *   3. the API only accepts application/json, which cross-site forms cannot send.
 * Browsers always attach Origin to such requests; its absence means a non-browser client,
 * which has no ambient cookie to abuse.
 */
export function requireTrustedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) return next(forbidden('Cross-site request refused.'));
    next();
  };
}
