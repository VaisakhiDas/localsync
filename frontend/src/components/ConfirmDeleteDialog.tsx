import { useState } from 'react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface ConfirmDeleteDialogProps {
  title: string;
  /**
   * "leave" is for documents shared with you: it removes YOUR access, never the owner's copy.
   * "discard" is for a read-only copy you already lost access to: it only removes the local copy.
   */
  mode?: 'delete' | 'leave' | 'discard';
  /** Resolves true when the delete succeeded (the dialog then closes). */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}

export function ConfirmDeleteDialog({ title, mode = 'delete', onConfirm, onClose }: ConfirmDeleteDialogProps) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    const ok = await onConfirm();
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      title={mode === 'leave' ? 'Leave this document?' : mode === 'discard' ? 'Remove this copy?' : 'Delete document?'}
      description={
        mode === 'leave'
          ? `You will lose access to “${title}” until the owner invites you again. The owner’s copy is not affected.`
          : mode === 'discard'
            ? `This removes the read-only copy of “${title}” saved on this device. You no longer have access to it, and nothing on the server changes. This cannot be undone.`
            : `“${title}” will be permanently deleted for everyone it is shared with. This cannot be undone.`
      }
      onClose={onClose}
    >
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={handleConfirm} disabled={busy}>
          {mode === 'leave' ? 'Leave' : mode === 'discard' ? 'Remove copy' : 'Delete'}
        </Button>
      </div>
    </Dialog>
  );
}
