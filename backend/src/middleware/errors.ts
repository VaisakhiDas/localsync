import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@localsync/shared';
import { errorFields, type Logger } from '../logger';

/** An error that is safe to show to the client: its status, machine code and message are public. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, 'invalid_request', message, fields);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthenticated', message);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, 'forbidden', message);
/** Used for "does not exist" AND "exists but you may not know about it": the two must be indistinguishable. */
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'No such endpoint.' } satisfies ApiErrorBody);
};

export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, fields: err.fields } satisfies ApiErrorBody);
      return;
    }
    // body-parser errors: malformed JSON / body too large.
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'The request body is not valid JSON.' } satisfies ApiErrorBody);
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'too_large', message: 'The request body is too large.' } satisfies ApiErrorBody);
      return;
    }
    log.error('unhandled request error', errorFields(err));
    // Never leak internals (SQL, stack traces) to the client.
    res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' } satisfies ApiErrorBody);
  };
}
