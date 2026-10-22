import { useMemo, useSyncExternalStore } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { createPresenceStore } from '../lib/presence';

/** Who else is here right now. Ephemeral: derived from awareness, never stored in the document. */
export function PresenceBar({ awareness, selfUserId }: { awareness: Awareness; selfUserId: string }) {
  const store = useMemo(() => createPresenceStore(awareness, selfUserId), [awareness, selfUserId]);
  const peers = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const typing = peers.filter((p) => p.typing);

  if (peers.length === 0) return null;
  return (
    <div className="flex items-center gap-2" aria-label="People viewing this document">
      <ul className="flex -space-x-2">
        {peers.slice(0, 5).map((peer) => (
          <li
            key={peer.userId}
            title={peer.name}
            style={{ backgroundColor: peer.color }}
            className="flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white"
          >
            <span aria-hidden="true">{peer.name.slice(0, 1).toUpperCase()}</span>
            <span className="sr-only">{peer.name} is here</span>
          </li>
        ))}
        {peers.length > 5 && (
          <li className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-zinc-200 text-xs font-medium text-zinc-700">
            +{peers.length - 5}
          </li>
        )}
      </ul>
      <p role="status" className="hidden min-w-0 truncate text-xs text-zinc-500 md:block" data-testid="typing-indicator">
        {typing.length === 0 ? '' : typing.length === 1 ? `${typing[0]!.name} is typing…` : `${typing.length} people are typing…`}
      </p>
    </div>
  );
}
