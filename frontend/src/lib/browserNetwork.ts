import type { NetworkMonitor } from '@localsync/shared/sync';

/**
 * `navigator.onLine === false` is reliable ("there is definitely no network"); `true` only means
 * "some network interface is up". So the browser event stops reconnect attempts early, and a
 * failing WebSocket handles the other case (connected to Wi-Fi, but no internet / server down).
 */
export const browserNetwork: NetworkMonitor = {
  isOnline: () => navigator.onLine,
  subscribe(listener) {
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  },
};
