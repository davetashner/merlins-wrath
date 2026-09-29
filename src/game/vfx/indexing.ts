// Checked-by-construction reads (mw-e29.1). With noUncheckedIndexedAccess every typed-array or list
// read is `T | undefined`, but the particle loops only read indices they have bounds-checked, and the
// lookups below only ask for keys they created. These say so once instead of at every read.

/** `items[index]`, for an index known to be in range. */
export const at = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;

/** A value known to be present (a map lookup of a key the caller created). */
export const known = <T>(value: T): NonNullable<T> => value as NonNullable<T>;
