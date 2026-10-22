import { FilePlus2, Plus } from 'lucide-react';
import { DocumentList } from '../components/DocumentList';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/ui/StatusViews';
import { useDocuments } from '../hooks/documents-context';
import { useCreateDocument } from '../hooks/useCreateDocument';

export function DashboardPage() {
  const { documents, status, loadError, actionError, dismissActionError, reload, metadataSync } = useDocuments();
  const { createAndOpen, creating } = useCreateDocument();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-zinc-600">Everything you can open, newest first.</p>
        </div>
        <Button variant="primary" onClick={createAndOpen} disabled={creating}>
          <Plus className="size-4" aria-hidden="true" />
          New document
        </Button>
      </div>

      {metadataSync === 'offline' && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You’re offline. Everything here still works; new documents and changes upload automatically when you’re back.
        </p>
      )}
      {actionError && (
        <div className="mb-4">
          <ErrorBanner message={actionError} onDismiss={dismissActionError} />
        </div>
      )}

      {status === 'loading' && <LoadingBlock label="Loading documents" />}
      {status === 'error' && <ErrorBanner message={loadError ?? 'Could not load your documents.'} onRetry={reload} />}
      {status === 'ready' && documents.length === 0 && (
        <EmptyState
          icon={<FilePlus2 className="size-6" aria-hidden="true" />}
          title="No documents yet"
          action={
            <Button variant="primary" onClick={createAndOpen} disabled={creating}>
              Create your first document
            </Button>
          }
        >
          Documents you create are saved on this device first, so they keep working offline.
        </EmptyState>
      )}
      {status === 'ready' && documents.length > 0 && <DocumentList documents={documents} />}
    </div>
  );
}
