import type { UserDto } from '@localsync/shared';
import { openDB } from 'idb';

/**
 * Remembers WHO was signed in, so the app can open offline (the server cannot confirm a session
 * with no network). It holds the user's id, email and name only: no password, no session token
 * (that lives in an HttpOnly cookie JavaScript cannot read). It is a convenience, not proof of
 * identity: the server re-checks the real cookie on every request and every WebSocket connection.
 */
const db = () => openDB('localsync:auth', 1, { upgrade: (d) => void d.createObjectStore('kv') });

export async function loadCachedUser(): Promise<UserDto | null> {
  try {
    return ((await (await db()).get('kv', 'user')) as UserDto | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedUser(user: UserDto): Promise<void> {
  try {
    await (await db()).put('kv', user, 'user');
  } catch {
    /* best effort */
  }
}

export async function clearCachedUser(): Promise<void> {
  try {
    await (await db()).delete('kv', 'user');
  } catch {
    /* best effort */
  }
}
