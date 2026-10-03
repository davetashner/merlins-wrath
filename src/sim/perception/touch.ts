// Touch (mw-e11.6): a target bumping into an agent, as a pure function of sampled values. Every agent
// feels touch, whatever its sense profile, in any light and from any side: a target whose feet are
// within the agent's radius plus the tuning's reach on the ground plane, and within the tuning's
// height vertically, is a `touched` percept of sense `touch` at its feet, strength and certainty 1.
// Awareness treats a touch as instant detection (src/sim/ai/awareness.ts).

import type { Vec3 } from '../stimulus/shapes';
import { percept, type Percept, type PerceptSource } from './percept';
import type { PerceptionTuning } from './tuning';

/** The sense name of touch percepts. */
export const TOUCH_SENSE = 'touch';

/**
 * The touch percept of a target with feet at `feet` against an agent standing at `at` with radius
 * `radius` (metres), or undefined when they are not in contact.
 */
export function touchPercept(
  at: Vec3,
  radius: number,
  target: { readonly source: PerceptSource; readonly feet: Vec3 },
  tuning: PerceptionTuning,
): Percept | undefined {
  const { feet } = target;
  const dx = feet.x - at.x;
  const dz = feet.z - at.z;
  const reach = radius + tuning.touch.reach;
  if (dx * dx + dz * dz > reach * reach || Math.abs(feet.y - at.y) > tuning.touch.height) {
    return undefined;
  }
  return percept({
    source: target.source,
    kind: 'touched',
    sense: TOUCH_SENSE,
    position: feet,
    strength: 1,
    certainty: 1,
  });
}
