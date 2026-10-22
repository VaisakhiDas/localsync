/// <reference types="node" />
/**
 * Browsers fire `window` "unhandledrejection" for promises nobody handled; Node
 * (where the tests run) raises `process` "unhandledRejection" instead, which Vitest
 * reports as a failure. y-indexeddb leaves an internal promise unhandled when the
 * database cannot be opened, and our code listens for that on `window`.
 *
 * This bridges the Node event to a `window` event so the production listener is the
 * thing under test. Call the returned function to restore Vitest's own handling.
 */
export function routeUnhandledRejectionsToWindow(): () => void {
  const saved = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  const bridge = (reason: unknown, promise: Promise<unknown>) => {
    window.dispatchEvent(Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason, promise }));
  };
  process.on('unhandledRejection', bridge);
  return () => {
    process.off('unhandledRejection', bridge);
    saved.forEach((listener) => process.on('unhandledRejection', listener));
  };
}
