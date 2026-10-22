import type { UserDto } from '@localsync/shared';
import type { Db } from '../db/pool';
import { isPgError, UNIQUE_VIOLATION } from '../db/pool';
import { conflict } from '../middleware/errors';
import { hashPassword, verifyPassword } from './passwords';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

const toDto = (row: Pick<UserRow, 'id' | 'email' | 'display_name'>): UserDto => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
});

export async function createUser(
  db: Db,
  input: { email: string; displayName: string; password: string },
  scryptCost: number,
): Promise<UserDto> {
  const passwordHash = await hashPassword(input.password, scryptCost);
  try {
    const { rows } = await db.query<UserRow>(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name, password_hash',
      [input.email, input.displayName, passwordHash],
    );
    return toDto(rows[0]!);
  } catch (err) {
    if (isPgError(err, UNIQUE_VIOLATION)) throw conflict('email_taken', 'An account with that email already exists.');
    throw err;
  }
}

// Verifying against a real-looking hash for unknown emails makes "no such user" take as long as
// "wrong password", so response time does not reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function authenticate(db: Db, email: string, password: string, scryptCost: number): Promise<UserDto | null> {
  const { rows } = await db.query<UserRow>('SELECT id, email, display_name, password_hash FROM users WHERE email = $1', [email]);
  const row = rows[0];
  if (!row) {
    dummyHash ??= hashPassword('this-user-does-not-exist', scryptCost);
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? toDto(row) : null;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserDto | null> {
  const { rows } = await db.query<UserRow>('SELECT id, email, display_name, password_hash FROM users WHERE email = $1', [email]);
  return rows[0] ? toDto(rows[0]) : null;
}
