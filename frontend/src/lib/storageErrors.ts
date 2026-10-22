const QUOTA_RE = /QuotaExceeded|quota/i;

/** A message safe to show to the user for any IndexedDB failure. */
export function describeStorageFailure(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (QUOTA_RE.test(text)) {
    return 'This device is out of storage space, so your latest changes may not be saved. Free some space, then reload.';
  }
  return 'Local storage is unavailable (for example in a private window or with site data blocked), so changes cannot be saved on this device.';
}

const INDEXEDDB_FAILURE_RE =
  /\b(QuotaExceededError|AbortError|UnknownError|InvalidStateError|NotFoundError|VersionError|SecurityError|TransactionInactiveError)\b/;

/**
 * Is this rejection reason an IndexedDB failure? y-indexeddb writes updates
 * fire-and-forget through lib0, which rejects with `new Error(String(domException))`,
 * so we have to look at the message as well as the DOMException name.
 */
export function isIndexedDbFailure(reason: unknown): boolean {
  if (reason instanceof DOMException) return INDEXEDDB_FAILURE_RE.test(reason.name);
  if (reason instanceof Error) return INDEXEDDB_FAILURE_RE.test(`${reason.name} ${reason.message}`);
  return false;
}
