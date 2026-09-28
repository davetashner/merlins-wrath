// Typed save-storage failures (mw-e30.2). Browser storage fails in ways the player can act on (disk
// full) and ways they can't (the browser refused); both must surface loudly, never as a silently
// missing save. Writes throw these; the previous save is always left intact.

/** The browser refused the write because the origin is out of storage quota. */
export class SaveQuotaError extends Error {
  override readonly name = 'SaveQuotaError';
  readonly kind = 'quota';
  /** What the UI should suggest to the player. */
  readonly suggestion = 'free up space';

  constructor(override readonly cause: unknown) {
    super(`not enough storage space to save; free up space and try again (${String(cause)})`);
  }
}

/** Any other storage failure: the database could not be opened, a transaction aborted, etc. */
export class SaveStorageError extends Error {
  override readonly name = 'SaveStorageError';
  readonly kind = 'storage';

  constructor(
    /** What was being attempted, e.g. `write slot "manual-1"`. */
    readonly operation: string,
    override readonly cause: unknown,
  ) {
    super(`save storage failed to ${operation}: ${String(cause)}`);
  }
}

/** Every error a store operation can throw; discriminate on `kind`. */
export type SaveStoreError = SaveQuotaError | SaveStorageError;

// Chrome, Safari and the spec say QuotaExceededError; older Firefox builds used their own name.
const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

/** True when `error` is the browser's out-of-quota DOMException (or an Error named like one). */
export function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && QUOTA_NAMES.has(error.name);
}

/** Wraps a raw storage failure in the matching typed error. */
export function toSaveStoreError(operation: string, error: unknown): SaveStoreError {
  if (isQuotaExceeded(error)) return new SaveQuotaError(error);
  return new SaveStorageError(operation, error);
}
