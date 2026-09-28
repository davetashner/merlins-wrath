// Typed storage errors (mw-e30.2 AC-3): quota failures are recognisable whatever the browser calls
// them, and everything else is wrapped with the operation that failed.
import { describe, expect, it } from 'vitest';
import { isQuotaExceeded, SaveQuotaError, SaveStorageError, toSaveStoreError } from './errors';

describe('storage errors', () => {
  it('AC-3: recognises quota errors by their browser names', () => {
    expect(isQuotaExceeded(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceeded(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
    expect(isQuotaExceeded(new DOMException('nope', 'AbortError'))).toBe(false);
    expect(isQuotaExceeded({ name: 'QuotaExceededError' })).toBe(false);
  });

  it('AC-3: maps a quota error to SaveQuotaError that tells the UI to free up space', () => {
    const cause = new DOMException('full', 'QuotaExceededError');
    const error = toSaveStoreError('write slot "a"', cause);
    expect(error).toBeInstanceOf(SaveQuotaError);
    expect(error).toMatchObject({ name: 'SaveQuotaError', kind: 'quota', cause });
    expect(error.message).toContain('free up space');
    expect(error instanceof SaveQuotaError && error.suggestion).toBe('free up space');
  });

  it('wraps any other failure in SaveStorageError naming the operation', () => {
    const error = toSaveStoreError('read slot "a"', 'boom');
    expect(error).toBeInstanceOf(SaveStorageError);
    expect(error).toMatchObject({
      name: 'SaveStorageError',
      kind: 'storage',
      operation: 'read slot "a"',
      cause: 'boom',
      message: 'save storage failed to read slot "a": boom',
    });
  });
});
