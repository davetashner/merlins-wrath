// Movement profiles (mw-e02.10): how visible and how loud a character's movement is, as numbers that
// stealth reads instead of poking at controller internals. Thief constitution: stance and speed must
// feed visibility and noise, not just a crouch flag and an eye icon.
//
// A profile is derived from the controller's published state every tick, so it is never stale and
// adds nothing to snapshots:
//   stance      standing or crouched (the controller's stance after this tick's stand-up check)
//   gait        still / slowWalk / walk / run / sprint, first match wins:
//                 still      slower than the gait tuning's walkFrom
//                 sprint     sprinting
//                 slowWalk   the slow-walk modifier held, or a light stick (CharacterState.slowWalk)
//                 walk       crouched (moving crouched is a walk at any crouch speed)
//                 run        at runFrom or faster
//                 walk       otherwise
//   silhouette  the height of the collision capsule the character stands in (crouching lowers it)
//   noise       the stance × gait noise multiplier from content, times the encumbrance multiplier
//               (the armor load class, ADR-0003, supplied by inventory: mw-e17.13), clamped to 1
//   visibility  the stance × gait visibility multiplier from content; armor never changes it
//
// Scoring is not here: visibility scoring is mw-e09.2 and noise propagation mw-e09.5; they and the
// AI's senses read the profile.

import type { ControllerTuning, Frozen, MovementStance, StealthGait } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import { capsuleOf, DEFAULT_STEALTH_TUNING, type CharacterState } from './controller';
import { DEFAULT_GAIT_TUNING } from './locomotion';
import { CharacterController, CharacterTuning } from './system';

/** How visible and loud a character's movement is this tick (see the file header). */
export interface MovementProfile {
  readonly stance: MovementStance;
  readonly gait: StealthGait;
  /** Height of the character's collision capsule, feet to crown, m. */
  readonly silhouetteHeight: number;
  /** Footstep noise multiplier, 0–1 (stand-sprint unencumbered is 1). */
  readonly noise: number;
  /** Visibility multiplier, 0–1 (stand-sprint is 1). */
  readonly visibility: number;
}

/**
 * What a character's equipment does to its movement profile: the noise multiplier of its armor load
 * class (ADR-0003: 1.0 / 1.3 / 1.6 / 1.8 Light / Medium / Heavy / Overloaded), written by inventory.
 * Characters without one move unencumbered (×1).
 */
export interface Encumbrance {
  /** Multiplies the stance × gait noise, > 0. */
  readonly noise: number;
}

/** A character's encumbrance (see Encumbrance); register it to let inventory supply one. */
export const CharacterEncumbrance = defineComponent<Encumbrance>('character.encumbrance');

/** The gait of a character's movement this tick (see the file header). */
export function movementGait(state: CharacterState, tuning: Frozen<ControllerTuning>): StealthGait {
  const { walkFrom, runFrom } = tuning.gait ?? DEFAULT_GAIT_TUNING;
  const { x, z } = state.velocity;
  const speed = Math.sqrt(x * x + z * z);
  if (speed < walkFrom) return 'still';
  if (state.sprinting) return 'sprint';
  if (state.slowWalk === true) return 'slowWalk';
  if (state.crouched) return 'walk';
  return speed >= runFrom ? 'run' : 'walk';
}

/**
 * The movement profile of a character in `state` moving with `tuning`, with an encumbrance noise
 * multiplier (1 = none). Pure.
 */
export function movementProfile(
  state: CharacterState,
  tuning: Frozen<ControllerTuning>,
  encumbrance = 1,
): MovementProfile {
  if (!(encumbrance > 0) || !Number.isFinite(encumbrance)) {
    throw new RangeError(`encumbrance must be a positive number, got ${String(encumbrance)}`);
  }
  const stance: MovementStance = state.crouched ? 'crouched' : 'standing';
  const gait = movementGait(state, tuning);
  const { noise, visibility } = (tuning.stealth ?? DEFAULT_STEALTH_TUNING).profiles[stance][gait];
  return {
    stance,
    gait,
    silhouetteHeight: capsuleOf(state, tuning).height,
    noise: Math.min(1, noise * encumbrance),
    visibility,
  };
}

/**
 * `entity`'s movement profile this tick, from its controller state, its own tuning (else
 * `fallback`) and its encumbrance; undefined when it has no controller or no tuning to read.
 */
export function movementProfileOf(
  world: Pick<World<never>, 'get' | 'isRegistered'>,
  entity: EntityId,
  fallback?: Frozen<ControllerTuning>,
): MovementProfile | undefined {
  const state = world.get(entity, CharacterController);
  const own = world.isRegistered(CharacterTuning) ? world.get(entity, CharacterTuning) : undefined;
  const tuning = own ?? fallback;
  if (state === undefined || tuning === undefined) return undefined;
  const load = world.isRegistered(CharacterEncumbrance)
    ? world.get(entity, CharacterEncumbrance)
    : undefined;
  return movementProfile(state, tuning, load?.noise ?? 1);
}
