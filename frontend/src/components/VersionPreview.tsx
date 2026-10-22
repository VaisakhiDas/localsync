import type { VersionDto } from '@localsync/shared';
import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useState } from 'react';
import { createEditorExtensions } from '../editor/extensions';
import { api, NetworkError } from '../lib/api';
import { CONTENT_FIELD } from '../lib/documentStore';
import { docFromVersion } from '../lib/versions';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { ErrorBanner, Spinner } from './ui/StatusViews';

interface VersionPreviewProps {
  documentId: string;
  version: VersionDto;
  /** Whether this person may restore (editors and owners). */
  canRestore: boolean;
  /** Restoring needs a live, fully synchronised connection (see below). */
  restoreBlockedReason: string | null;
  onRestore: (state: Uint8Array) => Promise<void>;
  onClose: () => void;
}

const label = (v: VersionDto) => v.label ?? (v.createdById ? 'Saved version' : 'Automatic checkpoint');

/** A read-only look at an old version. It is rendered from a private copy: nothing here touches the live document. */
export function VersionPreview({ documentId, version, canRestore, restoreBlockedReason, onRestore, onClose }: VersionPreviewProps) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    api.versionState(documentId, version.id).then(
      (state) => !ignore && setBytes(state),
      (err: unknown) => !ignore && setError(err instanceof NetworkError ? 'Viewing history needs a connection to the server.' : 'Could not load this version.'),
    );
    return () => {
      ignore = true;
    };
  }, [documentId, version.id]);

  return (
    <Dialog title={label(version)} description={`${version.createdByName ? `Saved by ${version.createdByName}` : 'Created automatically'} · ${new Date(version.createdAt).toLocaleString()}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      {!bytes && !error && <Spinner label="Loading version" />}
      {bytes && <ReadOnlyContent state={bytes} />}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {canRestore && restoreBlockedReason && <p className="mr-auto text-xs text-zinc-500">{restoreBlockedReason}</p>}
        <Button onClick={onClose}>Close</Button>
        {canRestore && (
          <Button
            variant="primary"
            disabled={!bytes || busy || restoreBlockedReason !== null}
            onClick={async () => {
              if (!bytes) return;
              setBusy(true);
              try {
                await onRestore(bytes);
              } catch (err) {
                setError(err instanceof NetworkError ? 'Restoring needs a connection to the server.' : 'Could not restore this version.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore this version
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function ReadOnlyContent({ state }: { state: Uint8Array }) {
  const ydoc = useMemo(() => docFromVersion(state), [state]);
  useEffect(() => () => ydoc.destroy(), [ydoc]);
  const extensions = useMemo(
    () => createEditorExtensions({ history: false, extra: [Collaboration.configure({ document: ydoc, field: CONTENT_FIELD })] }),
    [ydoc],
  );
  const editor = useEditor({ extensions, editable: false, editorProps: { attributes: { 'aria-label': 'Version preview', role: 'document' } } }, [extensions]);
  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3" data-testid="version-preview">
      <EditorContent editor={editor} />
    </div>
  );
}
