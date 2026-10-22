const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", then a plain date for anything older than a week. */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return new Date(timestamp).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}
