/**
 * Domain rules shared by the browser and the server.
 *
 * The *server* is the only place these rules are enforced for real. The browser
 * imports the same helpers purely to decide what to render (e.g. hide the
 * "Share" button from a viewer); a modified client gains nothing from them.
 */

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** May change the document body (and therefore push Yjs updates to the server). */
export const canEdit = (role: Role): boolean => role === 'owner' || role === 'editor';

/** May add comments and capture/restore versions. */
export const canContribute = (role: Role): boolean => canEdit(role);

/** May invite/remove collaborators and change roles. */
export const canManageMembers = (role: Role): boolean => role === 'owner';

/** May delete the document for everybody. */
export const canDelete = (role: Role): boolean => role === 'owner';

// Documents are identified by client-generated UUIDs so that they can be
// created offline. Anything else in a URL / API path is rejected early.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

export const TITLE_MAX_LENGTH = 200;
export const DEFAULT_TITLE = 'Untitled document';

/** Collapses whitespace and enforces the length limit; empty becomes the default title. */
export function normalizeTitle(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : DEFAULT_TITLE;
}
