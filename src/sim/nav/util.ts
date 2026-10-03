// Index lookups that are in range by construction (noUncheckedIndexedAccess can't see it, and lint
// forbids `!`), for the nav module's flat arrays.

/** `items[index]` for an index known to be in range. */
export function at<T>(items: ArrayLike<T>, index: number): T {
  return items[index] as T;
}

/** A value known to be present by construction. */
export function known<T>(value: T | undefined): T {
  return value as T;
}
