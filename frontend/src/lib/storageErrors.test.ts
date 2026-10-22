import { describe, expect, it } from 'vitest';
import { describeStorageFailure, isIndexedDbFailure } from './storageErrors';

describe('storage error classification', () => {
  it('recognises IndexedDB failures however lib0 wraps them', () => {
    expect(isIndexedDbFailure(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isIndexedDbFailure(new Error('QuotaExceededError: The quota has been exceeded.'))).toBe(true);
    expect(isIndexedDbFailure(new Error('AbortError: Transaction aborted'))).toBe(true);
  });

  it('ignores unrelated rejections', () => {
    expect(isIndexedDbFailure(new Error('Network request failed'))).toBe(false);
    expect(isIndexedDbFailure(new TypeError('x is not a function'))).toBe(false);
    expect(isIndexedDbFailure('QuotaExceededError')).toBe(false);
    expect(isIndexedDbFailure(undefined)).toBe(false);
  });

  it('gives a specific message for a full disk and a generic one otherwise', () => {
    expect(describeStorageFailure(new DOMException('full', 'QuotaExceededError'))).toMatch(/out of storage space/);
    expect(describeStorageFailure(new Error('boom'))).toMatch(/storage is unavailable/);
  });
});
