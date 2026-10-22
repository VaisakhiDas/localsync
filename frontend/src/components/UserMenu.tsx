import { LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '../hooks/auth-context';
import { useDocuments } from '../hooks/documents-context';
import { NetworkError } from '../lib/api';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

export function UserMenu() {
  const user = useUser();
  const { signOut } = useAuth();
  const { store, documents } = useDocuments();
  const [open, setOpen] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function run(removeLocalData: boolean) {
    setBusy(true);
    setError(null);
    try {
      await signOut(); // revoke on the server first: if we are offline this throws and nothing is deleted
      if (removeLocalData) await store.wipe();
    } catch (err) {
      setError(err instanceof NetworkError ? 'You are offline. Signing out needs a connection so the server can end your session.' : 'Could not sign out. Please try again.');
      setOpen(true);
    } finally {
      setBusy(false);
      setConfirmWipe(false);
    }
  }

  const unsynced = documents.filter((d) => !d.registered).length;

  return (
    <div ref={root} className="relative ml-auto">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm hover:bg-zinc-100"
      >
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{user.displayName}</span>
        <span className="sr-only sm:hidden">{user.displayName}</span>
      </button>

      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <p className="truncate px-3 py-2 text-xs text-zinc-500">{user.email}</p>
          {error && (
            <p role="alert" className="mx-2 mb-1 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">
              {error}
            </p>
          )}
          <button
            role="menuitem"
            type="button"
            disabled={busy}
            onClick={() => void run(false)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setConfirmWipe(true);
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
          >
            Sign out and remove local data
          </button>
        </div>
      )}

      {confirmWipe && (
        <Dialog
          title="Remove documents from this device?"
          description="Use this on a shared computer. Everything saved on the server stays safe and returns when you sign in again."
          onClose={() => setConfirmWipe(false)}
        >
          {unsynced > 0 && (
            <p role="alert" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {unsynced} document{unsynced === 1 ? ' has' : 's have'} not been uploaded yet. Removing local data will lose {unsynced === 1 ? 'it' : 'them'} for good.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmWipe(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void run(true)}>
              Sign out and remove
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
