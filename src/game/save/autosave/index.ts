// Public API of autosave (mw-e30.5): the scheduler that writes the autosave ring at safe moments,
// the safety-veto registry systems use to delay it, the ring's slot choice, and checkpoint volumes
// as triggers.

export { autosaveAtCheckpoints } from './checkpoints';
export { pickAutosaveSlot } from './ring';
export {
  AUTOSAVE_INTERVAL_SECONDS,
  AUTOSAVE_MIN_GAP_SECONDS,
  AutosaveScheduler,
  type AutosaveEvent,
  type AutosaveInput,
  type AutosaveListener,
  type AutosaveSchedulerOptions,
  type AutosaveTrigger,
  type AutosaveTriggerKind,
} from './scheduler';
export { SafetyVetoes, type ActiveVeto, type SafetyVeto } from './vetoes';
