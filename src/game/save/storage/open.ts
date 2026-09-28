// Picks the save store at startup (mw-e30.2): IndexedDB when the browser allows it, otherwise the
// in-memory fallback plus a warning the game must keep on screen, because saves that silently vanish
// on reload are worse than no saves at all.

import { SaveStorageError } from './errors';
import { IndexedDbSaveStore } from './indexeddb';
import { MemorySaveStore } from './memory';
import { PersistingSaveStore, type StorageManagerLike } from './persistence';
import type { SaveStore } from './store';

/** Shown in a persistent banner while saves live only in memory. */
export const SAVES_NOT_PERSISTED_WARNING =
  'Saves will not persist: this browser is blocking storage (private browsing?). Progress is lost when this page closes.';

/** The browser facilities saves use, injected so startup is testable outside a browser. */
export interface SaveStoreEnvironment {
  /** `globalThis.indexedDB`; undefined where the browser does not expose it. */
  readonly indexedDB: IDBFactory | undefined;
  /** `navigator.storage`; undefined in insecure contexts and older browsers. */
  readonly storage: StorageManagerLike | undefined;
  /** Database name override (tests). Defaults to SAVE_DB_NAME. */
  readonly databaseName?: string;
}

/** The store the game should use, and whether the player must be warned about it. */
export type OpenedSaveStore =
  | { readonly store: PersistingSaveStore; readonly warning: undefined }
  | {
      readonly store: SaveStore;
      /** Text for a persistent banner. */
      readonly warning: string;
      /** Why IndexedDB could not be used, for diagnostics. */
      readonly reason: SaveStorageError;
    };

/** Opens IndexedDB saves, falling back to memory (with a warning) when IndexedDB is unusable. */
export async function openSaveStore(env: SaveStoreEnvironment): Promise<OpenedSaveStore> {
  let reason: SaveStorageError;
  if (env.indexedDB === undefined) {
    reason = new SaveStorageError('open the save database', 'IndexedDB is not available');
  } else {
    try {
      const store = await IndexedDbSaveStore.open(env.indexedDB, env.databaseName);
      return { store: new PersistingSaveStore(store, env.storage), warning: undefined };
    } catch (error) {
      // IndexedDbSaveStore.open only ever throws SaveStorageError.
      reason = error as SaveStorageError;
    }
  }
  return { store: new MemorySaveStore(), warning: SAVES_NOT_PERSISTED_WARNING, reason };
}
