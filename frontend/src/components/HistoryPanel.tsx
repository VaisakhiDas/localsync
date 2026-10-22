import { canContribute, type VersionDto } from '@localsync/shared';
import { History } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type * as Y from 'yjs';
import { api, NetworkError } from '../lib/api';
import { restoreVersion } from '../lib/versions';
import type { DocumentMeta } from '../types/document';
import { SidePanel } from './SidePanel';
import { Button } from './ui/Button';
import { EmptyState, ErrorBanner, Spinner } from './ui/StatusViews';
import { VersionPreview } from './VersionPreview';

const labelOf = (v: VersionDto) => v.label ?? (v.createdById ? 'Saved version' : 'Automatic checkpoint');

interface HistoryPanelProps {
  doc: DocumentMeta;
  ydoc: Y.Doc;
  /** True only when the server has stored everything on this device ("Synced"). */
  synced: boolean;
  onClose: () => void;
}

export function HistoryPanel({ doc, ydoc, synced, onClose }: HistoryPanelProps) {
  const [versions, setVersions] = useState<VersionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<VersionDto | null>(null);
  const contributor = canContribute(doc.role);

  const describeError = (err: unknown) => (err instanceof NetworkError ? 'History needs a connection to the server.' : 'Something went wrong. Please try again.');

  useEffect(() => {
    let ignore = false;
    api.listVersions(doc.id).then(
      (list) => !ignore && setVersions(list),
      (err: unknown) => !ignore && setError(describeError(err)),
    );
    return () => {
      ignore = true;
    };
  }, [doc.id]);

  const refresh = useCallback(async () => setVersions(await api.listVersions(doc.id)), [doc.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveVersion(doc.id, label.trim() || undefined);
      setLabel('');
      setNotice('Version saved.');
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: VersionDto, state: Uint8Array) {
    // 1. Safety net: save the CURRENT server state first, so a restore can itself be undone.
    await api.saveVersion(doc.id, `Before restoring “${labelOf(version)}”`);
    // 2. The restore is an ordinary new edit of the live document; it syncs like any other.
    restoreVersion(ydoc, state);
    setPreviewing(null);
    setNotice('Restored. The text from just before is saved in this history, so you can go back.');
    await refresh().catch(() => undefined);
  }

  // The server freezes ITS state. If our latest edits have not reached it, the version would silently miss them.
  const savingBlocked = synced ? null : 'Wait for “Synced” so the version includes your latest changes.';

  return (
    <SidePanel title="Version history" onClose={onClose}>
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {notice && (
        <p role="status" className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {contributor && (
        <form onSubmit={save} className="mb-4 space-y-2">
          <label htmlFor="version-label" className="block text-sm font-medium text-zinc-700">
            Save the current version
          </label>
          <input
            id="version-label"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name it (optional)"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <Button type="submit" variant="primary" disabled={busy || !synced} className="w-full">
            Save version
          </Button>
          {savingBlocked && <p className="text-xs text-zinc-500">{savingBlocked}</p>}
        </form>
      )}

      {!versions && !error && <Spinner label="Loading history" />}
      {versions && versions.length === 0 && (
        <EmptyState icon={<History className="size-6" aria-hidden="true" />} title="No versions yet">
          Versions are saved automatically as you work. You can also save one yourself.
        </EmptyState>
      )}
      {versions && versions.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{labelOf(v)}</p>
                <p className="text-xs text-zinc-500">
                  {v.createdByName ?? 'Automatic'} · {new Date(v.createdAt).toLocaleString()}
                </p>
              </div>
              <Button variant="ghost" aria-label={`Preview ${labelOf(v)} from ${new Date(v.createdAt).toLocaleString()}`} onClick={() => setPreviewing(v)}>
                Preview
              </Button>
            </li>
          ))}
        </ul>
      )}

      {previewing && (
        <VersionPreview
          documentId={doc.id}
          version={previewing}
          canRestore={contributor}
          restoreBlockedReason={synced ? null : 'Restoring needs a live connection and “Synced” status, so the safety copy is complete.'}
          onRestore={(state) => restore(previewing, state)}
          onClose={() => setPreviewing(null)}
        />
      )}
    </SidePanel>
  );
}
