// Self-visibility from the world (mw-e09.2): the observer-independent visibility of a character as
// the HUD's light-exposure gem reads it (mw-e09.10), sampled from real world state each time it is
// asked, so it adds nothing to snapshots and is never stale:
//   light    the light field at the character's sight sample points (head, chest, hips, feet of its
//            current capsule, DEFAULT_SIGHT_SAMPLES), so crouching lowers them
//   stance   crouched or standing, from its controller (no prone yet)
//   motion   its horizontal speed
//   profile  its `stealth.visibilityProfile` component when that is registered and present, else
//            neutral. Nothing writes it yet: equipment brightness and cloaks/disguises need item data
//            that does not exist (follow-up), so a world without it reads every character as neutral.

import type { ControllerTuning, Frozen, VisibilityTuning } from '@content/index';
import { movementProfileOf } from '../character/profile';
import { CharacterController } from '../character/system';
import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { LightField } from '../light/field';
import { DEFAULT_SIGHT_SAMPLES } from '../sight/line-of-sight';
import {
  DEFAULT_VISIBILITY_TUNING,
  selfVisibilityTerms,
  type SelfVisibilityTerms,
  type VisibilityProfile,
} from './visibility';

/** What a character wears that changes how it reads; register it to let equipment supply one. */
export const VisibilityProfileComponent = defineComponent<VisibilityProfile>(
  'stealth.visibilityProfile',
);

/** Light levels at the points a sight line samples on a body of `height` standing at `feet`. */
export function bodyLightSamples(
  light: Pick<LightField, 'levelAt'>,
  feet: { readonly x: number; readonly y: number; readonly z: number },
  height: number,
  fractions: readonly number[] = DEFAULT_SIGHT_SAMPLES,
): number[] {
  return fractions.map((f) => light.levelAt({ x: feet.x, y: feet.y + height * f, z: feet.z }));
}

/**
 * `entity`'s self-visibility and its terms, sampled from `world` and `light`; undefined when it has
 * no character controller or no controller tuning to read (its own, else `fallback`).
 */
export function selfVisibilityOf(
  world: Pick<World<never>, 'get' | 'isRegistered'>,
  light: Pick<LightField, 'levelAt'>,
  entity: EntityId,
  options: {
    readonly tuning?: VisibilityTuning;
    readonly fallback?: Frozen<ControllerTuning>;
  } = {},
): SelfVisibilityTerms | undefined {
  const state = world.get(entity, CharacterController);
  if (state === undefined) return undefined;
  const movement = movementProfileOf(world, entity, options.fallback);
  if (movement === undefined) return undefined;
  const { x, z } = state.velocity;
  const profile = world.isRegistered(VisibilityProfileComponent)
    ? world.get(entity, VisibilityProfileComponent)
    : undefined;
  return selfVisibilityTerms(
    {
      lightSamples: bodyLightSamples(light, state.position, movement.silhouetteHeight),
      stance: movement.stance,
      speed: Math.sqrt(x * x + z * z),
      ...(profile === undefined ? {} : { profile }),
    },
    options.tuning ?? DEFAULT_VISIBILITY_TUNING,
  );
}
