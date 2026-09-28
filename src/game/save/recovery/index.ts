// Public API of save corruption recovery (mw-e30.8): the recovering load path (backup, then other
// saves, then a new game), its typed results and message keys, the local telemetry events it emits,
// and the damaged-save bug-report export. The load screens (mw-e30.11) render the messages.

export {
  SaveRecovery,
  type DamagedCopy,
  type RecoveryCandidate,
  type RecoveryLoadResult,
  type RecoveryMessage,
  type RecoveryOffer,
  type SaveCopyRef,
  type SaveRecoveryEvent,
  type SaveRecoveryOptions,
} from './recovery';
export {
  buildDamagedSaveReport,
  DAMAGED_SAVE_REPORT_KIND,
  DAMAGED_SAVE_REPORT_VERSION,
  type DamagedSaveReportFile,
} from './report';
