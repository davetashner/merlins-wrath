// UI ↔ game glue (mw-e00.23). The UI layer only reports what is open (UiState: capturesInput,
// pausesSim); this bridge turns that into loop behaviour:
// - while a screen captures input, the per-tick sampler still runs (so key and pad state stays
//   current and nothing replays late) but its gameplay action frames are withheld from the sim;
// - while a screen pauses the sim, the frame loop runs no steps (FrameLoopOptions.simPaused) and the
//   bridge drains gameplay input once per frame, so keys pressed in a menu never leak into the game.
// Both read the UI state on every call, so closing a menu releases capture on the very next tick.
import type { UiState } from '@ui/index';
import type { CommandSampler } from '../loop';

export interface UiGameBridgeOptions<TCommand> {
  readonly ui: UiState;
  /** The gameplay sampler (ActionSampler.sampleCommands). */
  readonly sampleCommands: CommandSampler<TCommand>;
  /** Consumes pending gameplay input and discards it (e.g. `() => sampler.sample()`). */
  readonly drain?: () => void;
}

export interface UiGameBridge<TCommand> {
  /** Pass to the game loop: the gameplay commands, or none while the UI captures input. */
  readonly sampleCommands: CommandSampler<TCommand>;
  /** Pass to the game loop: true while an open screen pauses the sim. */
  readonly simPaused: () => boolean;
  /** Call once per rendered frame (drains gameplay input while paused). */
  frame(): void;
}

const NONE: readonly never[] = Object.freeze([]);

export function createUiGameBridge<TCommand>(
  options: UiGameBridgeOptions<TCommand>,
): UiGameBridge<TCommand> {
  const { ui, sampleCommands, drain } = options;
  return {
    sampleCommands: (tick) => {
      const commands = sampleCommands(tick);
      return ui.capturesInput ? NONE : commands;
    },
    simPaused: () => ui.pausesSim,
    frame: () => {
      if (ui.pausesSim) drain?.();
    },
  };
}
