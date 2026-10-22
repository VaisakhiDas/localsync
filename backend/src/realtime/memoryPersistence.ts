import type { DocumentPersistence } from './types';

/** Volatile persistence for tests and for running without a database. */
export function createMemoryPersistence(): DocumentPersistence & { snapshot(id: string): Uint8Array | undefined } {
  const states = new Map<string, Uint8Array>();
  return {
    async load(id) {
      const state = states.get(id);
      return state ? state.slice() : null;
    },
    async store(id, state) {
      states.set(id, state.slice());
    },
    snapshot: (id) => states.get(id),
  };
}
