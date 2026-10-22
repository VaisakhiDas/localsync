const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Turns whatever the user typed into a safe href, or null if it is unusable.
 * `javascript:`, `data:` and friends are rejected by the protocol allow-list.
 */
export function normalizeLinkUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;

  // "localhost:3000/x" looks like a scheme ("localhost:") but is host:port.
  const looksLikeHostPort = /^[^:/?#]+:\d+(?:[/?#]|$)/.test(raw);
  let candidate = raw;
  if (looksLikeHostPort || !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    // No scheme: "me@example.com" is an email, anything else is a web address.
    candidate = /^[^@/]+@[^@/]+\.[^@/]+$/.test(raw) ? `mailto:${raw}` : `https://${raw}`;
  }

  try {
    const url = new URL(candidate);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.protocol === 'mailto:' ? candidate : url.href;
  } catch {
    return null;
  }
}
