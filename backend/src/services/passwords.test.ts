import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret passphrase', 1024);
    expect(await verifyPassword('s3cret passphrase', hash)).toBe(true);
    expect(await verifyPassword('s3cret passphrasE', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('never stores the password and salts every hash differently', async () => {
    const a = await hashPassword('same password', 1024);
    const b = await hashPassword('same password', 1024);
    expect(a).not.toContain('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('records its cost, so hashes made with an older setting still verify after the setting changes', async () => {
    const old = await hashPassword('pw', 1024);
    expect(old.split('$').slice(0, 4)).toEqual(['scrypt', '1024', '8', '1']);
    expect(await verifyPassword('pw', old)).toBe(true);
  });

  it('treats equivalent Unicode spellings of a password as the same (NFKC)', async () => {
    const hash = await hashPassword('café-pass', 1024); // é as one code point
    expect(await verifyPassword('café-pass', hash)).toBe(true); // e + combining accent
  });

  it.each(['', 'plaintext', 'scrypt$x$8$1$AAAA$BBBB', 'scrypt$1024$8$1$$', 'bcrypt$1024$8$1$AAAA$BBBB', 'scrypt$999999999$8$1$AAAA$BBBB', 'scrypt$1024$9$1$AAAA$BBBB'])(
    'rejects a malformed or tampered stored hash (%j) without throwing',
    async (stored) => {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    },
  );
});
