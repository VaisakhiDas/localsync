import type { Config } from '../config';
import { errorFields, type Logger } from '../logger';
import { Room } from './room';
import type { DocumentPersistence } from './types';

interface RoomManagerDeps {
  persistence: DocumentPersistence;
  config: Pick<Config, 'PERSIST_DEBOUNCE_MS' | 'PERSIST_MAX_WAIT_MS' | 'MAX_MESSAGES_PER_SECOND' | 'ROOM_IDLE_MS'>;
  log: Logger;
}

/** Owns every live room: creates them on demand, keeps empty ones briefly, evicts them safely. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: RoomManagerDeps) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  get connectionCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.connections.size;
    return total;
  }

  /** Finds or creates the room, waiting until its stored state has been loaded. Rejects if loading fails. */
  async acquire(documentId: string): Promise<Room> {
    for (;;) {
      const existing = this.rooms.get(documentId);
      if (!existing) break;
      // A room being evicted is flushed first, so waiting guarantees the next load sees its data.
      if (existing.state === 'closing' || existing.state === 'closed') {
        await existing.closed;
        continue;
      }
      this.cancelIdle(documentId);
      await existing.ready;
      return existing;
    }

    const room = new Room(documentId, { ...this.deps, onEmpty: (r) => this.onEmpty(r) });
    this.rooms.set(documentId, room);
    try {
      await room.ready;
    } catch (err) {
      this.rooms.delete(documentId);
      room.destroy();
      throw err;
    }
    return room;
  }

  /** Call after using a room without a connection (e.g. a REST request) so it can be evicted again. */
  releaseIfEmpty(room: Room): void {
    if (room.connections.size === 0) this.onEmpty(room);
  }

  /** Drops a deleted document's room immediately, without saving it. */
  discard(documentId: string): void {
    const room = this.rooms.get(documentId);
    if (!room) return;
    this.cancelIdle(documentId);
    room.discard();
    this.rooms.delete(documentId);
    room.destroy();
  }

  private onEmpty(room: Room): void {
    if (this.rooms.get(room.id) !== room) return; // already discarded or replaced
    // Persist right away (nobody is there to watch the debounce), then keep the room warm for
    // quick reconnects before evicting it.
    void room.flush();
    this.cancelIdle(room.id);
    this.idleTimers.set(
      room.id,
      setTimeout(() => void this.evict(room), this.deps.config.ROOM_IDLE_MS),
    );
  }

  private cancelIdle(documentId: string): void {
    clearTimeout(this.idleTimers.get(documentId));
    this.idleTimers.delete(documentId);
  }

  private async evict(room: Room): Promise<void> {
    this.idleTimers.delete(room.id);
    if (room.connections.size > 0 || room.state !== 'open') return;
    room.beginClose(); // synchronously: from now on acquire() waits for us instead of reusing the room
    await this.finish(room);
  }

  /** flush -> remove from the map -> destroy, in that order, so a replacement room never reads stale data. */
  private async finish(room: Room): Promise<void> {
    try {
      await room.flush();
    } catch (err) {
      this.deps.log.error('flush during close failed', { documentId: room.id, ...errorFields(err) });
    }
    this.rooms.delete(room.id);
    room.destroy();
  }

  /** Graceful shutdown: close every connection, persist everything, release all memory. */
  async closeAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    const rooms = [...this.rooms.values()];
    rooms.forEach((room) => room.beginClose());
    await Promise.all(rooms.map((room) => this.finish(room)));
  }
}
