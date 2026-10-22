import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './ui/Button';

/** A panel beside the document on wide screens (lg+); an overlay below that, where there is no room beside the page. */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside
      aria-label={title}
      className="flex w-full shrink-0 flex-col border-l border-zinc-200 bg-white max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-14 max-lg:z-30 lg:w-80"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
