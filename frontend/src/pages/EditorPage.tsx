import { canEdit } from '@localsync/shared';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { History, MessageSquare, Share2 } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DocumentTitle } from '../components/DocumentTitle';
import { Button } from '../components/ui/Button';
import { ErrorBanner, LoadingBlock } from '../components/ui/StatusViews';
import { CommentsPanel } from '../components/CommentsPanel';
import { HistoryPanel } from '../components/HistoryPanel';
import { ShareDialog } from '../components/ShareDialog';
import { useUser } from '../hooks/auth-context';
import { useDocuments } from '../hooks/documents-context';
import { useLocalDocument } from '../hooks/useLocalDocument';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { createEditorExtensions } from '../editor/extensions';
import { isLocalEditOrigin } from '../editor/origins';
import { PresenceBar } from '../editor/PresenceBar';
import { createTypingSignal } from '../lib/presence';
import { LocalSaveStatus } from '../editor/LocalSaveStatus';
import { OfflineNotice, SyncStatus } from '../editor/SyncStatus';
import { RichTextEditor } from '../editor/RichTextEditor';
import { CONTENT_FIELD, type LocalDocument } from '../lib/documentStore';
import type { DocumentMeta } from '../types/document';
import { NotFoundPage } from './NotFoundPage';

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const { documents, status, loadError, reload } = useDocuments();
  const doc = documents.find((d) => d.id === id);

  if (status === 'loading') return <LoadingBlock label="Opening document" />;
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorBanner message={loadError ?? 'Could not open the document.'} onRetry={reload} />
      </div>
    );
  }
  if (!doc) {
    return (
      <NotFoundPage
        title="Document not found"
        message="It may have been deleted, or it was never stored on this device."
      />
    );
  }
  return <DocumentEditor key={doc.id} doc={doc} />;
}

/** Opens the body from local storage first; the editor only mounts once that has finished. */
function DocumentEditor({ doc }: { doc: DocumentMeta }) {
  const { store } = useDocuments();
  const local = useLocalDocument(store, doc.id);

  if (local.status === 'loading') return <LoadingBlock label="Restoring document from this device" />;
  if (local.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
        <ErrorBanner message={local.error} />
        <Button onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    );
  }
  return <LoadedEditor doc={doc} local={local.doc} storageError={local.storageError} />;
}

function LoadedEditor({ doc, local, storageError }: { doc: DocumentMeta; local: LocalDocument; storageError: string | null }) {
  const { rename, touch, requestSync, actionError, dismissActionError } = useDocuments();
  const me = useUser();
  const [sharing, setSharing] = useState(false);
  const [panel, setPanel] = useState<'history' | 'comments' | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);

  // Yjs owns the content and the undo history, so ProseMirror's own history must be off.
  const extensions = useMemo(
    () =>
      createEditorExtensions({
        history: false,
        extra: [
          Collaboration.configure({ document: local.ydoc, field: CONTENT_FIELD }),
          // Remote carets and selections, drawn from awareness (ephemeral presence, not document content).
          // The server rewrites name/colour from the authenticated account, so what others see cannot be forged.
          CollaborationCaret.configure({ provider: { awareness: local.awareness }, user: { name: me.displayName, color: '#2747ad' } }),
        ],
      }),
    [local, me.displayName],
  );

  // Tell collaborators "typing…" while this user edits.
  useEffect(() => {
    const typing = createTypingSignal(local.awareness);
    const onUpdate = (_u: Uint8Array, origin: unknown) => isLocalEditOrigin(origin) && typing.pulse();
    local.ydoc.on('update', onUpdate);
    return () => {
      typing.stop();
      local.ydoc.off('update', onUpdate);
    };
  }, [local]);

  // Bump "last edited" (debounced) for changes made by this user, not for ones replayed from disk.
  const markEdited = useEffectEvent(() => void touch(local.id));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!isLocalEditOrigin(origin)) return;
      clearTimeout(timer);
      timer = setTimeout(markEdited, 1500);
    };
    local.ydoc.on('update', onUpdate);
    return () => {
      clearTimeout(timer);
      local.ydoc.off('update', onUpdate);
    };
  }, [local]);

  // Local editing never depends on the network. The server may still demote us to read-only
  // (the permission it enforces is the real one; ours only decides what to show).
  // A document made offline is not known to the server yet; it connects once it has been uploaded.
  const revoked = doc.revoked === true;
  const sync = useSyncStatus(local, doc.registered === true && !revoked);
  const editable = canEdit(doc.role) && !sync.snapshot.readOnly && !revoked;

  // Whenever the connection (re)opens, refresh our role and the document list. This is how a
  // PROMOTION reaches an open editor promptly: the server already pushes demotions to us (via the
  // read-only notice), but a new, higher role is otherwise only learnt on the periodic sync.
  // A refusal ("denied") is stable, unlike a connection that opens and is closed again within a
  // moment, so it is the dependable signal that our access changed.
  const connected = sync.snapshot.connected;
  const denied = sync.snapshot.phase === 'denied';
  useEffect(() => {
    if (connected || denied) requestSync();
  }, [connected, denied, requestSync]);

  return (
    // Title, status and toolbar stay pinned; only the page below them scrolls.
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white px-3 py-2">
        {/* On a phone the title gets a row of its own; the controls wrap underneath. */}
        <div className="min-w-0 basis-full sm:basis-60 sm:flex-1">
          <DocumentTitle title={doc.title} readOnly={!editable} onCommit={(t) => void rename(doc.id, t)} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
          <PresenceBar awareness={local.awareness} selfUserId={me.id} />
          <SyncStatus snapshot={sync.snapshot} enabled={sync.enabled} revoked={revoked} />
          <LocalSaveStatus error={storageError} />
          <Button
            aria-pressed={panel === 'comments'}
            onClick={() => setPanel((p) => (p === 'comments' ? null : 'comments'))}
            disabled={doc.registered !== true}
            title={doc.registered === true ? 'Comments' : 'Available once the document has been uploaded.'}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            <span className="max-lg:sr-only">Comments</span>
          </Button>
          <Button
            aria-pressed={panel === 'history'}
            onClick={() => setPanel((p) => (p === 'history' ? null : 'history'))}
            disabled={doc.registered !== true}
            title={doc.registered === true ? 'Version history' : 'Available once the document has been uploaded.'}
          >
            <History className="size-4" aria-hidden="true" />
            <span className="max-lg:sr-only">History</span>
          </Button>
          <Button
            onClick={() => setSharing(true)}
            disabled={doc.registered !== true || revoked}
            title={doc.registered === true && !revoked ? undefined : 'Sharing is available once the document has been uploaded and while you have access.'}
          >
            <Share2 className="size-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Share</span>
          </Button>
        </div>
      </div>
      {sharing && <ShareDialog doc={doc} onClose={() => setSharing(false)} />}
      <OfflineNotice snapshot={sync.snapshot} enabled={sync.enabled} />
      {sync.snapshot.phase === 'denied' && (
        <div className="px-3 pt-3">
          <ErrorBanner
            message={
              sync.snapshot.denied?.code === 4401
                ? 'Your sign-in is no longer valid, so this document is not syncing. Your changes are still saved on this device.'
                : 'You do not have access to this document on the server, so it is not syncing. Your changes are still saved on this device.'
            }
            onRetry={sync.retry}
          />
        </div>
      )}
      {revoked && (
        <p role="status" className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-900">
          You no longer have access to this document: it was deleted or unshared. This is a read-only copy saved on this device; nothing is lost. You can remove it from the document list when you no longer need it.
        </p>
      )}
      {!editable && !revoked && (
        <p role="status" className="border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs text-zinc-700">
          You have view-only access to this document{doc.ownerName ? ` (shared by ${doc.ownerName})` : ''}. You can read it, but not change it.
        </p>
      )}
      {actionError && (
        <div className="px-3 pt-3">
          <ErrorBanner message={actionError} onDismiss={dismissActionError} />
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <RichTextEditor extensions={extensions} editable={editable} onEditorReady={setEditorInstance} />
        {panel === 'history' && <HistoryPanel doc={doc} ydoc={local.ydoc} synced={sync.snapshot.phase === 'synced'} onClose={() => setPanel(null)} />}
        {panel === 'comments' && (
          <CommentsPanel
            doc={doc}
            getSelectionText={() => {
              const sel = editorInstance?.state.selection;
              return sel && !sel.empty ? editorInstance!.state.doc.textBetween(sel.from, sel.to, ' ') : '';
            }}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
