import { COLLAB_PATH } from '@localsync/shared';

/** The sync endpoint on the page's own origin (the dev server / reverse proxy forwards it to the backend). */
export function collabServerUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${COLLAB_PATH}`;
}
