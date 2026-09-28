// Storage persistence and quota (mw-e30.2). Browsers may evict "best-effort" origin storage under
// pressure; asking for persistent storage on the first save makes that far less likely. The request
// is best-effort itself: unsupported, denied or throwing, saving carries on regardless.

import type { SaveStore, SlotCopy, SlotReadResult } from './store';

/** The parts of `navigator.storage` saves use; every member may be missing in older browsers. */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimate>;
}

/** Outcome of the persistent-storage request. */
export type PersistenceState = 'not-requested' | 'granted' | 'denied' | 'unavailable';

/** Wraps a durable store so the first write also asks the browser to keep storage persistent. */
export class PersistingSaveStore implements SaveStore {
  private request: Promise<PersistenceState> | undefined;

  constructor(
    private readonly inner: SaveStore,
    private readonly storage: StorageManagerLike | undefined,
  ) {}

  get kind(): SaveStore['kind'] {
    return this.inner.kind;
  }

  get durable(): boolean {
    return this.inner.durable;
  }

  /**
   * The persistence request's outcome; 'not-requested' before the first write. The request is never
   * awaited by a write, since some browsers answer it with a permission prompt.
   */
  persistence(): Promise<PersistenceState> {
    return this.request ?? Promise.resolve('not-requested');
  }

  write(slot: string, bytes: Uint8Array): Promise<void> {
    this.request ??= this.requestPersistence();
    return this.inner.write(slot, bytes);
  }

  read(slot: string, copy?: SlotCopy): Promise<SlotReadResult> {
    return this.inner.read(slot, copy);
  }

  list(): Promise<readonly string[]> {
    return this.inner.list();
  }

  delete(slot: string): Promise<void> {
    return this.inner.delete(slot);
  }

  private async requestPersistence(): Promise<PersistenceState> {
    const storage = this.storage;
    if (storage?.persist === undefined) return 'unavailable';
    try {
      return (await storage.persist()) ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  }
}

/** Bytes used and available to this origin. */
export interface SaveQuota {
  readonly usage: number;
  readonly quota: number;
}

/**
 * Estimates this origin's storage use, e.g. to tell a player who hit SaveQuotaError how much space
 * is left. Undefined when the browser cannot say.
 */
export async function estimateSaveQuota(
  storage: StorageManagerLike | undefined,
): Promise<SaveQuota | undefined> {
  if (storage?.estimate === undefined) return undefined;
  try {
    const { usage, quota } = await storage.estimate();
    return usage === undefined || quota === undefined ? undefined : { usage, quota };
  } catch {
    return undefined;
  }
}
