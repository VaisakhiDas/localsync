/**
 * Creates three DEMO accounts and one shared document, for trying the app (and the two-window
 * demo script). The passwords are public and printed below, so this refuses to run in production.
 */
import { loadConfig, loadDotEnv } from '../src/config';
import { createPool, isPgError, UNIQUE_VIOLATION } from '../src/db/pool';
import { ensureDocument, upsertMember } from '../src/services/documents';
import { createUser, findUserByEmail } from '../src/services/users';

loadDotEnv();
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('Refusing to create demo accounts with a published password in production.');
  process.exit(1);
}
if (!config.DATABASE_URL) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}

const PASSWORD = 'demo-password-123';
const demo = [
  { email: 'alice@example.com', displayName: 'Alice (owner)' },
  { email: 'bob@example.com', displayName: 'Bob (editor)' },
  { email: 'vera@example.com', displayName: 'Vera (viewer)' },
];

const db = createPool(config.DATABASE_URL);
try {
  const users = [];
  for (const account of demo) {
    try {
      users.push(await createUser(db, { ...account, password: PASSWORD }, config.SCRYPT_COST));
    } catch (err) {
      if (!(err instanceof Error) || !/already exists/.test(err.message)) throw err;
      users.push((await findUserByEmail(db, account.email))!);
    }
  }
  const [alice, bob, vera] = users as [(typeof users)[number], (typeof users)[number], (typeof users)[number]];
  const documentId = '00000000-0000-4000-8000-00000000d3a0';
  await ensureDocument(db, alice.id, documentId, 'Demo: shared notes');
  await upsertMember(db, documentId, bob.id, 'editor');
  await upsertMember(db, documentId, vera.id, 'viewer');
  console.log('Demo accounts (password for all: %s):', PASSWORD);
  for (const a of demo) console.log('  %s', a.email);
  console.log('Shared document: Demo: shared notes (alice owns it, bob edits, vera views).');
} catch (err) {
  if (isPgError(err, UNIQUE_VIOLATION)) console.error('Seed data conflicts with existing rows.');
  throw err;
} finally {
  await db.end();
}
