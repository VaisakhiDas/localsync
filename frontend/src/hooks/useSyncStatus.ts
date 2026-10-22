import { SyncController, type SyncSnapshot } from '@localsync/shared/sync';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { browserNetwork } from '../lib/browserNetwork';
import { collabServerUrl } from '../lib/collabConfig';
import type { LocalDocument } from '../lib/documentStore';

const NOT_STARTED: SyncSnapshot = { phase: 'offline', connected: false, upToDate: false, readOnly: false, denied: null };

export interface SyncState {
  snapshot: SyncSnapshot;
  /** Whether synchronisation is switched on at all (it is off if no server is configured). */
  enabled: boolean;
  /** Try again after a permanent refusal (e.g. after signing in again). */
  retry: () => void;
}

/**
 * Connects an already-restored local document to the sync server for as long as the component
 * is mounted, and exposes the honest sync status.
 *
 * The controller is created when React subscribes (effect time), never during render, so React
 * StrictMode's mount/unmount/mount cycle cannot leak sockets or timers.
 */
export function useSyncStatus(local: LocalDocument, enabled: boolean): SyncState {
  const controllerRef = useRef<SyncController | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) return () => undefined;
      const controller = new SyncController({
        serverUrl: collabServerUrl(),
        documentId: local.id,
        ydoc: local.ydoc,
        awareness: local.awareness,
        network: browserNetwork,
      });
      controllerRef.current = controller;
      const unsubscribe = controller.subscribe(onChange);
      controller.connect();
      onChange(); // the controller now exists: re-read the snapshot
      return () => {
        unsubscribe();
        controller.destroy();
        controllerRef.current = null;
      };
    },
    [local, enabled],
  );

  const getSnapshot = useCallback(() => controllerRef.current?.getSnapshot() ?? NOT_STARTED, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const retry = useCallback(() => controllerRef.current?.connect(), []);

  return { snapshot, enabled, retry };
}
