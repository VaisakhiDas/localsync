import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './time';

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0, 0);
  it('formats recent times relatively', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('yesterday');
  });
  it('falls back to a date after a week', () => {
    expect(formatRelativeTime(now - 30 * 86_400_000, now)).toMatch(/2026/);
  });
});
