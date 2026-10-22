import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl } from './link';

describe('normalizeLinkUrl', () => {
  it('keeps http(s) and mailto addresses', () => {
    expect(normalizeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeLinkUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
  });

  it('adds a scheme when it is missing', () => {
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com/');
    expect(normalizeLinkUrl('me@example.com')).toBe('mailto:me@example.com');
    expect(normalizeLinkUrl('  localhost:3000/x ')).toBe('https://localhost:3000/x');
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'vbscript:x'])(
    'rejects dangerous scheme %s',
    (input) => {
      expect(normalizeLinkUrl(input)).toBeNull();
    },
  );

  it.each(['', '   ', 'two words', 'nodots'])('rejects unusable input %j', (input) => {
    expect(normalizeLinkUrl(input)).toBeNull();
  });
});
