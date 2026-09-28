// The save-store contract (mw-e30.2): opaque save bytes per named slot, with the previous write
// kept as a backup. Slot UX (mw-e30.4), autosave (mw-e30.5) and corruption recovery (mw-e30.8) sit
// on this interface, so the IndexedDB store and the in-memory fallback are interchangeable and are
// held to one shared contract test.

import type { SaveCorruptError } from '../format/index';

/** Which copy of a slot to read: the latest write, or the one it replaced. */
export type SlotCopy = 'current' | 'backup';

/** Outcome of reading one copy of a slot. */
export type SlotReadResult =
  | { readonly status: 'ok'; readonly bytes: Uint8Array; readonly generation: number }
  | { readonly status: 'empty' }
  /** The stored record itself is damaged (missing or malformed blob, bad slot pointer). */
  | { readonly status: 'corrupt'; readonly error: SaveCorruptError };

/** Where a store keeps its saves. */
export type SaveStoreKind = 'indexeddb' | 'memory';

/**
 * Persists save bytes per slot. Every write is atomic: it either fully replaces the slot (the old
 * current copy becoming its backup) or leaves the slot exactly as it was and throws.
 */
export interface SaveStore {
  readonly kind: SaveStoreKind;
  /** False when saves vanish on reload (the in-memory fallback). */
  readonly durable: boolean;
  /**
   * Stores `bytes` as the slot's current copy; the previous current copy becomes the backup and the
   * previous backup is dropped. The bytes are copied, so the caller may reuse its buffer.
   * @throws SaveQuotaError when out of storage space; SaveStorageError for any other failure. The
   *   slot keeps its previous contents in both cases.
   */
  write(slot: string, bytes: Uint8Array): Promise<void>;
  /**
   * Reads one copy of a slot (default: current). Returns a fresh copy of the bytes.
   * @throws SaveStorageError when storage itself fails.
   */
  read(slot: string, copy?: SlotCopy): Promise<SlotReadResult>;
  /**
   * Every slot that has a save, sorted.
   * @throws SaveStorageError when storage itself fails.
   */
  list(): Promise<readonly string[]>;
  /**
   * Removes a slot's current copy and its backup. Deleting an empty slot does nothing.
   * @throws SaveStorageError when storage itself fails.
   */
  delete(slot: string): Promise<void>;
}
