import { useState, type FormEvent } from 'react';
import { TITLE_MAX_LENGTH } from '@localsync/shared';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface RenameDialogProps {
  initialTitle: string;
  /** Resolves true when the rename succeeded (the dialog then closes). */
  onSubmit: (title: string) => Promise<boolean>;
  onClose: () => void;
}

export function RenameDialog({ initialTitle, onSubmit, onClose }: RenameDialogProps) {
  const [value, setValue] = useState(initialTitle);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit(value);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog title="Rename document" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label htmlFor="rename-input" className="block text-sm font-medium text-zinc-700">
          Title
        </label>
        <input
          id="rename-input"
          autoFocus
          value={value}
          maxLength={TITLE_MAX_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
