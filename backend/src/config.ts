import { z } from 'zod';

const origin = z.string().refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, 'must be an origin such as http://localhost:5173 (scheme, host, optional port; no path or trailing slash)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  /** Browser origins allowed to open WebSockets / call the API. Exact match, comma separated. */
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:4173')
    .transform((value) => value.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(origin).min(1)),
  DATABASE_URL: z.string().min(1).optional(),
  /** Send the session cookie only over HTTPS. Defaults to on in production. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** Set when running behind a reverse proxy so rate limiting sees real client IPs ("1" = one proxy hop). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** scrypt CPU/memory cost (N). Lowered in tests only; every hash records the cost it used. */
  SCRYPT_COST: z.coerce.number().int().min(1024).max(2 ** 20).default(2 ** 15),
  /** Take an automatic version checkpoint when a document is saved and the last version is older than this. */
  AUTO_VERSION_INTERVAL_MS: z.coerce.number().int().min(0).default(10 * 60 * 1000),
  /** Automatic checkpoints kept per document (saved versions are never pruned automatically). */
  AUTO_VERSIONS_KEPT: z.coerce.number().int().min(1).default(50),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  /** Largest single WebSocket message accepted. A first sync of a large offline document is one message. */
  MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  MAX_MESSAGES_PER_SECOND: z.coerce.number().int().positive().default(500),
  /** Save the document this long after the last change... */
  PERSIST_DEBOUNCE_MS: z.coerce.number().int().min(0).default(500),
  /** ...but never wait longer than this while changes keep arriving. */
  PERSIST_MAX_WAIT_MS: z.coerce.number().int().min(0).default(5000),
  /** Keep an empty room in memory this long (cheap reconnects), then evict it. */
  ROOM_IDLE_MS: z.coerce.number().int().min(0).default(30_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
});

/** The database that `npm run dev:db` starts. Used only outside production, so local scripts need no setup. */
export const DEV_DATABASE_URL = 'postgres://localsync:localsync-dev-only@127.0.0.1:54320/localsync';

export type Config = z.infer<typeof schema> & { cookieSecure: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const data = parsed.data;
  return {
    ...data,
    DATABASE_URL: data.DATABASE_URL ?? (data.NODE_ENV === 'production' ? undefined : DEV_DATABASE_URL),
    cookieSecure: data.COOKIE_SECURE ?? data.NODE_ENV === 'production',
  };
}

/**
 * Loads `.env` from the working directory or the repository root (npm runs workspace scripts
 * from the package folder). Variables that are already set in the real environment are kept.
 */
export function loadDotEnv(): void {
  for (const file of ['.env', '../.env']) {
    try {
      process.loadEnvFile(file);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
