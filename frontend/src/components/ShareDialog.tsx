import { canManageMembers, type MemberDto } from '@localsync/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '../hooks/auth-context';
import { api, ApiError, NetworkError } from '../lib/api';
import type { DocumentMeta } from '../types/document';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { ErrorBanner, Spinner } from './ui/StatusViews';

const describe = (err: unknown): string =>
  err instanceof NetworkError ? 'Sharing needs a connection to the server. Try again when you are online.' : err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

export function ShareDialog({ doc, onClose }: { doc: DocumentMeta; onClose: () => void }) {
  const me = useUser();
  const isOwner = canManageMembers(doc.role);
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');

  useEffect(() => {
    let ignore = false;
    api.listMembers(doc.id).then(
      (list) => !ignore && setMembers(list),
      (err: unknown) => !ignore && setError(describe(err)),
    );
    return () => {
      ignore = true;
    };
  }, [doc.id]);

  /** Runs one change; the server answers with the fresh member list (or nothing for deletions). */
  async function run(action: () => Promise<MemberDto[] | void>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setMembers(next);
      else setMembers(await api.listMembers(doc.id));
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await run(() => api.invite(doc.id, email, role));
    setEmail('');
  }

  return (
    <Dialog title={`Share “${doc.title}”`} description={isOwner ? 'People you add can open this document with the role you choose.' : 'Only the owner can change who has access.'} onClose={onClose}>
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {isOwner && (
        <form onSubmit={invite} className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="invite-email" className="block text-sm font-medium text-zinc-700">
              Email address
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-sm font-medium text-zinc-700">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              className="mt-1 rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
            Invite
          </Button>
        </form>
      )}

      <h3 className="mb-1 text-sm font-medium text-zinc-700">People with access</h3>
      {!members && !error && <Spinner label="Loading people" />}
      {members && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.displayName}
                  {m.userId === me.id && <span className="ml-1 font-normal text-zinc-500">(you)</span>}
                </p>
                <p className="truncate text-xs text-zinc-500">{m.email}</p>
              </div>
              {m.role === 'owner' || !isOwner ? (
                <span className="rounded bg-zinc-100 px-2 py-1 text-xs capitalize text-zinc-700">{m.role}</span>
              ) : (
                <>
                  <select
                    aria-label={`Role for ${m.displayName}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => void run(() => api.changeRole(doc.id, m.userId, e.target.value as 'editor' | 'viewer'))}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button variant="ghost" disabled={busy} aria-label={`Remove ${m.displayName}`} onClick={() => void run(() => api.removeMember(doc.id, m.userId))}>
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
