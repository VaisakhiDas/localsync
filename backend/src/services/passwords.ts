import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

const KEY_LENGTH = 64;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
/** Hard ceiling so a tampered stored hash cannot make us allocate gigabytes. */
const MAX_COST = 2 ** 20;

const options = (cost: number): ScryptOptions => ({
  N: cost,
  r: BLOCK_SIZE,
  p: PARALLELISM,
  maxmem: 256 * cost * BLOCK_SIZE, // scrypt needs ~128*N*r bytes; allow 2x headroom
});

/**
 * Hashes with scrypt (memory-hard, built into Node: no native add-on, no extra dependency).
 * Format: scrypt$N$r$p$salt$hash, so the cost can be raised later and old hashes still verify.
 */
export async function hashPassword(password: string, cost: number): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options(cost));
  return ['scrypt', cost, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  const cost = Number(n);
  if (scheme !== 'scrypt' || !saltB64 || !hashB64 || !Number.isInteger(cost) || cost < 2 || cost > MAX_COST) return false;
  if (Number(r) !== BLOCK_SIZE || Number(p) !== PARALLELISM) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, options(cost));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
