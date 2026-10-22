import type { SyncPhase, SyncSnapshot } from '@localsync/shared/sync';
import { CloudCheck, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

interface Presentation {
  label: string;
  detail: string;
  tone: string;
  icon: ReactNode;
}

const icon = 'size-3.5';

const PRESENTATION: Record<SyncPhase, Presentation> = {
  offline: {
    label: 'Offline',
    detail: 'Not connected to the server. You can keep editing: changes are saved on this device and will sync when the connection returns.',
    tone: 'bg-amber-50 text-amber-800',
    icon: <CloudOff className={icon} aria-hidden="true" />,
  },
  connecting: {
    label: 'Connecting',
    detail: 'Connecting to the server.',
    tone: 'bg-zinc-100 text-zinc-700',
    icon: <LoaderCircle className={`${icon} animate-spin`} aria-hidden="true" />,
  },
  syncing: {
    label: 'Syncing',
    detail: 'Connected. Waiting for the server to confirm it has stored your latest changes.',
    tone: 'bg-brand-50 text-brand-700',
    icon: <RefreshCw className={`${icon} animate-spin`} aria-hidden="true" />,
  },
  synced: {
    label: 'Synced',
    detail: 'The server has stored all of your changes.',
    tone: 'bg-emerald-50 text-emerald-800',
    icon: <CloudCheck className={icon} aria-hidden="true" />,
  },
  denied: {
    label: 'No access',
    detail: 'The server refused the connection.',
    tone: 'bg-red-50 text-red-700',
    icon: <TriangleAlert className={icon} aria-hidden="true" />,
  },
};

/**
 * The network half of the status. "Saved on this device" (LocalSaveStatus) and this chip answer
 * different questions: a change can be safe locally and not yet confirmed by the server.
 */
export function SyncStatus({ snapshot, enabled, revoked = false }: { snapshot: SyncSnapshot; enabled: boolean; revoked?: boolean }) {
  if (revoked) {
    return (
      <span
        role="status"
        data-sync-phase="revoked"
        title="You no longer have access. This is a read-only copy saved on this device."
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
      >
        <TriangleAlert className={icon} aria-hidden="true" />
        No longer shared
      </span>
    );
  }
  if (!enabled) {
    return (
      <span
        role="status"
        data-sync-phase="local"
        title="This document exists only on this device so far. It uploads automatically when you are online."
        className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600"
      >
        <CloudOff className={icon} aria-hidden="true" />
        Not uploaded yet
      </span>
    );
  }
  const view = PRESENTATION[snapshot.phase];
  const detail =
    snapshot.phase === 'denied' && snapshot.denied
      ? snapshot.denied.code === 4401
        ? 'Your sign-in is no longer valid. Sign in again to keep syncing.'
        : 'You do not have access to this document on the server.'
      : view.detail;
  return (
    <span
      // Polite live region: assistive tech announces changes without stealing focus.
      role="status"
      aria-live="polite"
      data-sync-phase={snapshot.phase}
      title={detail}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${view.tone}`}
    >
      {view.icon}
      {view.label}
    </span>
  );
}

/** A slim, non-blocking notice shown only while offline. */
export function OfflineNotice({ snapshot, enabled }: { snapshot: SyncSnapshot; enabled: boolean }) {
  if (!enabled || snapshot.phase !== 'offline') return null;
  return (
    <p className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
      You’re offline. Keep writing: your changes are saved on this device and will sync automatically when you’re back.
    </p>
  );
}
