// Public API of death → reload (mw-e30.7): the death screen flow, last-save resolution and the
// pending-load hand-off that carries a load across the page reload.

export {
  DeathReload,
  deathSaveEntry,
  recoveryText,
  slotName,
  type DeathReloadOptions,
  type DeathReloadReadout,
} from './controller';
export { findSaves, rankSaves, resolveLastSave, type SaveChoice } from './last-save';
export {
  clearPendingLoad,
  PENDING_LOAD_KEY,
  takePendingLoad,
  writePendingLoad,
  type PendingLoad,
  type PendingLoadStorage,
} from './pending';
