import { TITLE_MAX_LENGTH } from '@localsync/shared';
import { useState } from 'react';

interface DocumentTitleProps {
  title: string;
  readOnly: boolean;
  /** Called on blur / Enter with the raw text; the store normalises it. */
  onCommit: (title: string) => void;
}

/** Click-to-edit title. Escape reverts, Enter or blur saves. */
export function DocumentTitle({ title, readOnly, onCommit }: DocumentTitleProps) {
  // `null` means "not editing": show the stored title, so external renames
  // (dashboard, a collaborator) appear immediately. A string is the in-progress edit.
  const [draft, setDraft] = useState<string | null>(null);

  const finish = (commit: boolean) => {
    if (commit && draft !== null && draft.trim() !== title) onCommit(draft);
    setDraft(null);
  };

  return (
    <input
      aria-label="Document title"
      value={draft ?? title}
      readOnly={readOnly}
      maxLength={TITLE_MAX_LENGTH}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(title)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null); // discard before the blur handler runs
          e.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold hover:border-zinc-200 focus:border-zinc-300 focus:bg-white read-only:hover:border-transparent"
    />
  );
}
