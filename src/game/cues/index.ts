// Public API of the cue layer (mw-e28.3): data-driven cue sheets that map sim events to
// presentation. The matcher is generic so VFX cue sheets (e29.3) reuse it with their own fields.

export {
  AudioCueBridge,
  DEFAULT_CUE_SEED,
  soundVariantCount,
  worldCueLookups,
  type AudioCueBridgeOptions,
  type CueEventSource,
  type CuePlay,
  type CuePlayer,
} from './audio-bridge.ts';
export {
  CUE_EVENT_BINDINGS,
  type CueAnchor,
  type CueEventBinding,
  type CueLookups,
  type CueReading,
} from './events.ts';
export {
  CueRuleSet,
  interpolateCue,
  matchesFacts,
  type CueFacts,
  type CueFactValue,
  type MatchableRule,
} from './matcher.ts';
