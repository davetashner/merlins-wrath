// Public API of save storage (mw-e30.2): the SaveStore contract, the IndexedDB store with atomic
// writes and backups, the in-memory fallback, persistence/quota helpers and typed storage errors.
// Slots (mw-e30.4) and autosave (mw-e30.5) build on it.

export {
  isQuotaExceeded,
  SaveQuotaError,
  SaveStorageError,
  toSaveStoreError,
  type SaveStoreError,
} from './errors';
export { IndexedDbSaveStore, SAVE_DB_NAME, SAVE_DB_VERSION } from './indexeddb';
export { MemorySaveStore } from './memory';
export {
  openSaveStore,
  SAVES_NOT_PERSISTED_WARNING,
  type OpenedSaveStore,
  type SaveStoreEnvironment,
} from './open';
export {
  estimateSaveQuota,
  PersistingSaveStore,
  type PersistenceState,
  type SaveQuota,
  type StorageManagerLike,
} from './persistence';
export type { SaveStore, SaveStoreKind, SlotCopy, SlotReadResult } from './store';
