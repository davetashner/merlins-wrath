// Checkpoint volumes as autosave triggers (mw-e30.5). A checkpoint is an ordinary trigger volume
// in a signal graph (mw-e03.21) — typically filtered to the player tag — that the level marks as a
// checkpoint. Entering it requests an autosave; the scheduler waits for a safe moment. Which
// volumes count is the caller's decision (level data), so save code knows nothing about levels.

import { volumeEntered, type EventBus, type VolumeCrossing } from '@sim/index';
import type { AutosaveScheduler } from './scheduler';

/**
 * Requests a `checkpoint` autosave whenever an entity enters a volume `isCheckpoint` accepts. The
 * request's source is `<graph id>/<volume node id>`. Returns a function that stops listening.
 */
export function autosaveAtCheckpoints(
  events: EventBus,
  scheduler: Pick<AutosaveScheduler, 'request'>,
  isCheckpoint: (crossing: VolumeCrossing) => boolean,
): () => void {
  return events.on(volumeEntered, (crossing) => {
    if (isCheckpoint(crossing)) {
      scheduler.request({ kind: 'checkpoint', source: `${crossing.graphId}/${crossing.node}` });
    }
  });
}
