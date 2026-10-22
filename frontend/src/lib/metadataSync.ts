import type { DocumentDto } from '@localsync/shared';
import { ApiError, NetworkError, type Api } from './api';
import type { DocumentStore } from './documentStore';

export type MetadataSyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface MetadataSyncOptions {
  store: DocumentStore;
  api: Pick<Api, 'listDocuments' | 'registerDocument' | 'renameDocument' | 'deleteDocument' | 'removeMember'>;
  /** The signed-in user (needed to "leave" documents that are shared with them). */
  userId: string;
  /** The server rejected our session. */
  onUnauthorized?: () => void;
  /** Injectable for tests. */
  intervalMs?: number;
}

const toMs = (iso: string) => Date.parse(iso);

/**
 * Reconciles document METADATA (list, titles, roles, create/delete) with the server.
 *
 * Why this is not the same as document-content sync: a title is one small value, so the rule is
 * simply "last write wins" and each document carries a few flags saying what the server has not
 * been told yet (`registered`, `titleDirty`, deletion tombstone). Document BODIES are different:
 * they are Yjs CRDTs, reconciled by state-vector exchange (see SyncController), never by a queue.
 *
 * Every pass is idempotent, so being interrupted half-way (tab closed, network lost) is harmless:
 * the next pass simply continues.
 */
export class MetadataSync {
  private state: MetadataSyncState = 'idle';
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();
  private stopListening: (() => void) | undefined;

  constructor(private readonly options: MetadataSyncOptions) {}

  getSnapshot = (): MetadataSyncState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Called after a pass changed local records (so lists can refresh). */
  onChanged = (listener: () => void) => {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  };

  /** Begin syncing now and whenever the network, tab visibility or a timer suggests it. */
  start(): void {
    const trigger = () => this.requestSync(0);
    window.addEventListener('online', trigger);
    const onVisible = () => document.visibilityState === 'visible' && trigger();
    document.addEventListener('visibilitychange', onVisible);
    this.timer = setInterval(trigger, this.options.intervalMs ?? 60_000);
    this.stopListening = () => {
      window.removeEventListener('online', trigger);
      document.removeEventListener('visibilitychange', onVisible);
    };
    trigger();
  }

  stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.stopListening?.();
    this.listeners.clear();
    this.changeListeners.clear();
  }

  /** Ask for a pass soon. Bursts of requests (typing a title) collapse into one. */
  requestSync(delayMs = 300): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), delayMs);
  }

  /** Runs a pass; if one is already running, schedules exactly one follow-up. Never overlaps. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private setState(next: MetadataSyncState) {
    if (this.state === next) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  private async pass(): Promise<void> {
    this.setState('syncing');
    try {
      const pushed = await this.push();
      const pulled = await this.pull();
      if (pushed || pulled) this.changeListeners.forEach((l) => l());
      this.setState('idle');
    } catch (err) {
      if (err instanceof NetworkError) this.setState('offline');
      else if (err instanceof ApiError && err.status === 401) {
        this.setState('error');
        this.options.onUnauthorized?.();
      } else this.setState('error');
    }
  }

  /** Sends what the server has not been told. Returns true if any local record changed. */
  private async push(): Promise<boolean> {
    const { store, api, userId } = this.options;
    let changed = false;
    for (const doc of await store.listAll()) {
      if (doc.deleted) {
        if (doc.registered) {
          try {
            if (doc.role === 'owner') await api.deleteDocument(doc.id);
            else await api.removeMember(doc.id, userId); // "delete" of someone else's document = leave it
          } catch (err) {
            if (!(err instanceof ApiError && (err.status === 404 || err.status === 403))) throw err; // already gone / not ours
          }
        }
        await store.purge(doc.id);
        changed = true;
      } else if (!doc.registered) {
        const pushedTitle = doc.title;
        try {
          const server = await api.registerDocument(doc.id, pushedTitle);
          await store.updateMeta(doc.id, (cur) => ({
            ...cur,
            registered: true,
            role: server.role,
            ownerName: server.ownerName,
            // Only clear the flag if nobody renamed it while the request was in flight.
            titleDirty: cur.title === pushedTitle ? false : cur.titleDirty,
          }));
          changed = true;
        } catch (err) {
          // 403: the id belongs to someone else. Vanishingly rare with random UUIDs; leave it local.
          if (!(err instanceof ApiError && err.status === 403)) throw err;
        }
      } else if (doc.titleDirty) {
        const pushedTitle = doc.title;
        try {
          await api.renameDocument(doc.id, pushedTitle);
          await store.updateMeta(doc.id, (cur) => ({ ...cur, titleDirty: cur.title === pushedTitle ? false : cur.titleDirty }));
          changed = true;
        } catch (err) {
          if (!(err instanceof ApiError && (err.status === 403 || err.status === 404))) throw err; // pull below reconciles
        }
      }
    }
    return changed;
  }

  /** Brings in documents shared with us and new titles/roles, and marks the ones we lost access to. */
  private async pull(): Promise<boolean> {
    const { store, api } = this.options;
    const server = await api.listDocuments();
    const byId = new Map<string, DocumentDto>(server.map((d) => [d.id, d]));
    let changed = false;

    for (const dto of server) {
      const incoming = {
        id: dto.id,
        title: dto.title,
        role: dto.role,
        ownerName: dto.ownerName,
        createdAt: toMs(dto.createdAt),
        updatedAt: toMs(dto.updatedAt),
        registered: true,
      };
      if (await store.insertIfAbsent(incoming)) changed = true; // a document shared with us just arrived
      await store.updateMeta(dto.id, (cur) => {
        if (cur.deleted) return null; // our pending deletion wins
        const next = {
          ...cur,
          revoked: false, // listed again (e.g. re-invited): back to normal
          registered: true,
          role: dto.role,
          ownerName: dto.ownerName,
          title: cur.titleDirty ? cur.title : dto.title, // an unsent local rename beats the server's title
          updatedAt: Math.max(cur.updatedAt, incoming.updatedAt),
        };
        if (next.title === cur.title && next.role === cur.role && next.ownerName === cur.ownerName && next.updatedAt === cur.updatedAt && cur.registered && !cur.revoked) return null;
        changed = true;
        return next;
      });
    }

    // Registered here but unknown to the server: deleted by the owner, or our access was removed.
    // We do NOT delete the local copy (it may hold edits that never reached the server). It becomes a
    // read-only copy that the user can remove deliberately.
    for (const doc of await store.listAll()) {
      if (doc.registered && !doc.deleted && !doc.revoked && !byId.has(doc.id)) {
        await store.updateMeta(doc.id, (cur) => (cur.revoked ? null : { ...cur, revoked: true }));
        changed = true;
      }
    }
    return changed;
  }
}
