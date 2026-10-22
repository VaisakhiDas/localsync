export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** One JSON object per line: greppable locally, parseable by any log shipper. */
export function createLogger(level: LogLevel): Logger {
  const emit = (at: Exclude<LogLevel, 'silent'>, message: string, fields?: Record<string, unknown>) => {
    if (order[at] < order[level]) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: at, message, ...fields });
    (at === 'error' || at === 'warn' ? console.error : console.log)(line);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = createLogger('silent');

/** Errors carry stacks; log just enough to debug without leaking request data. */
export const errorFields = (err: unknown): Record<string, unknown> =>
  err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) };
