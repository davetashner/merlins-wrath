// The stimulus log (mw-e03.3): the recent resolutions, newest last, for the debug overlay and tests.
// It is a view built from `stimulusResolved` events, not sim state, so it is never snapshotted and
// recording it cannot change a replay.

import type { World } from '../core/world';
import { stimulusResolved, type StimulusResolution } from './stimulus';

/** A bounded, live record of stimulus resolutions. */
export interface StimulusLog {
  /** Resolutions delivered so far, oldest first, at most `capacity` (older ones are dropped). */
  readonly entries: readonly StimulusResolution[];
  /** Stops recording (entries are kept). */
  stop(): void;
}

/** Default number of resolutions a log keeps. */
export const DEFAULT_STIMULUS_LOG_CAPACITY = 256;

/** Starts recording `world`'s stimulus resolutions, keeping the latest `capacity` (≥ 1). */
export function recordStimulusLog(
  world: World<never>,
  capacity = DEFAULT_STIMULUS_LOG_CAPACITY,
): StimulusLog {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a positive integer, got ${String(capacity)}`);
  }
  const entries: StimulusResolution[] = [];
  const stop = world.events.on(stimulusResolved, (resolution) => {
    entries.push(resolution);
    if (entries.length > capacity) entries.shift();
  });
  return { entries, stop };
}
