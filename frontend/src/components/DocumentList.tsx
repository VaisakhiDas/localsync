import { canDelete, canEdit } from '@localsync/shared';
import { FileText, LogOut, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDocuments } from '../hooks/documents-context';
import { formatRelativeTime } from '../lib/time';
import type { DocumentMeta } from '../types/document';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { RenameDialog } from './RenameDialog';
import { IconButton } from './ui/Button';

export function DocumentList({ documents }: { documents: DocumentMeta[] }) {
  const { rename, remove } = useDocuments();
  const [renaming, setRenaming] = useState<DocumentMeta | null>(null);
  const [deleting, setDeleting] = useState<DocumentMeta | null>(null);

  return (
    <>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center gap-1 pr-2 hover:bg-zinc-50">
            <Link to={`/d/${doc.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
              <FileText className="size-5 shrink-0 text-zinc-400" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-zinc-900">{doc.title}</span>
                <span className="block text-xs text-zinc-500">
                  Edited {formatRelativeTime(doc.updatedAt)}
                  {doc.role !== 'owner' && (
                    <>
                      {doc.ownerName && <span> · Shared by {doc.ownerName}</span>}
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 capitalize">{doc.role}</span>
                    </>
                  )}
                  {doc.revoked ? (
                    <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-red-700">No longer shared · read-only copy</span>
                  ) : (
                    doc.registered !== true && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">Not uploaded yet</span>
                  )}
                </span>
              </span>
            </Link>
            <IconButton label={`Rename ${doc.title}`} disabled={!canEdit(doc.role) || doc.revoked === true} onClick={() => setRenaming(doc)}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            {doc.revoked ? (
              <IconButton label={`Remove ${doc.title} from this device`} onClick={() => setDeleting(doc)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : canDelete(doc.role) ? (
              <IconButton label={`Delete ${doc.title}`} onClick={() => setDeleting(doc)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton label={`Leave ${doc.title}`} onClick={() => setDeleting(doc)}>
                <LogOut className="size-4" aria-hidden="true" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>

      {renaming && (
        <RenameDialog
          initialTitle={renaming.title}
          onSubmit={(title) => rename(renaming.id, title)}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          title={deleting.title}
          mode={deleting.revoked ? 'discard' : canDelete(deleting.role) ? 'delete' : 'leave'}
          onConfirm={() => remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
