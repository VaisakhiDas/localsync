import { HardDrive, TriangleAlert } from 'lucide-react';

/**
 * "Saved on this device" means: the body was restored from IndexedDB and no write
 * failure has been observed. It says nothing about the server (see SyncStatus, M5).
 */
export function LocalSaveStatus({ error }: { error: string | null }) {
  if (error) {
    return (
      <span
        role="alert"
        title={error}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
      >
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        <span className="max-sm:sr-only">Not saved on this device</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
      <HardDrive className="size-3.5" aria-hidden="true" />
      <span className="max-sm:sr-only">Saved on this device</span>
    </span>
  );
}
