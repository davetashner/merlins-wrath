// The impulse API (mw-e02.15): one way for anything — a force stimulus (Gust, Thunderclap, an
// explosion), a blow's knockback (hit reactions, e04.7), a collapsing floor — to throw a character.
// An impulse is a velocity change (the push over the character's mass; callers that think in N·s
// divide by the mass they know), a source (credit and blame for where the character lands) and a
// stagger flag (a blast or a troll's blow takes control away; a self-cast Gust does not, and "too
// useful" is allowed).
//
// Applying one changes the character's velocity at once, so everything later in the tick sees it
// moving, and puts an airborne character into the controller's launched state (controller.ts). A
// grounded character only leaves the ground when the push rises: a flat push slides it along the
// ground, where friction (deceleration) soon stops it.
//
// Order independence: two systems may push the same character in one tick in either order. The
// state keeps the velocity the tick's first impulse found (downward speed dropped on the ground)
// and every impulse since, sorted canonically; the velocity is always that base plus their sum in
// that order, so the same impulses give the same bits whatever order they arrived in. The
// controller's next step consumes them.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { impulseApplied } from '../stimulus/stimulus';
import type { Vec3 } from '../stimulus/shapes';
import type { CharacterState, ImpulsePart } from './controller';
import { CharacterController } from './system';
import { add, dot, UP, vec, ZERO } from './vec';

/** An impulse on a character (see the file header). */
export interface CharacterImpulse {
  /** Velocity change, m/s. */
  readonly velocity: Vec3;
  /** The entity responsible, or null (default). */
  readonly source?: EntityId | null;
  /** Takes control away until the character has landed and recovered; default false. */
  readonly stagger?: boolean;
}

/** Canonical order of impulse parts: by velocity x, y, z, then source (none first), then stagger. */
function compareParts(a: ImpulsePart, b: ImpulsePart): number {
  return (
    a.velocity.x - b.velocity.x ||
    a.velocity.y - b.velocity.y ||
    a.velocity.z - b.velocity.z ||
    (a.source ?? 0) - (b.source ?? 0) ||
    Number(a.stagger) - Number(b.stagger)
  );
}

function checkedPart(impulse: CharacterImpulse): ImpulsePart {
  const { x, y, z } = impulse.velocity;
  if (![x, y, z].every(Number.isFinite)) {
    throw new RangeError('impulse velocity must be finite');
  }
  const source = impulse.source ?? null;
  if (source !== null && !(Number.isSafeInteger(source) && source >= 1)) {
    throw new RangeError(`impulse source must be an entity id or null, got ${String(source)}`);
  }
  return Object.freeze({
    velocity: Object.freeze({ x, y, z }),
    source,
    stagger: impulse.stagger ?? false,
  });
}

/**
 * `state` pushed by `impulse` (see the file header). Pure. The launch's source is the strongest
 * sourced part's (the first in canonical order among equals), else the launch's own; it staggers
 * when any part does or it already did. Throws a RangeError for a non-finite velocity or a bad source id.
 */
export function impelCharacter(state: CharacterState, impulse: CharacterImpulse): CharacterState {
  const part = checkedPart(impulse);
  const { velocity: v, grounded } = state;
  const base = state.impulses?.base ?? (grounded ? vec(v.x, Math.max(v.y, 0), v.z) : v);
  const parts = Object.freeze([...(state.impulses?.parts ?? []), part].sort(compareParts));
  let sum = ZERO;
  for (const p of parts) sum = add(sum, p.velocity);
  const velocity = add(base, sum);
  const next: CharacterState = { ...state, velocity, impulses: Object.freeze({ base, parts }) };
  if (grounded && velocity.y <= 0) return next;
  let lead: ImpulsePart | undefined;
  for (const p of parts) {
    if (p.source === null) continue;
    if (lead === undefined || dot(p.velocity, p.velocity) > dot(lead.velocity, lead.velocity)) {
      lead = p;
    }
  }
  return {
    ...next,
    grounded: false,
    groundNormal: UP,
    groundBody: null,
    jumped: true,
    launch: Object.freeze({
      source: lead?.source ?? state.launch?.source ?? null,
      stagger: parts.some((p) => p.stagger) || state.launch?.stagger === true,
    }),
  };
}

/**
 * Pushes `entity`'s character (see the file header). Returns false, doing nothing, when it has no
 * CharacterController. Throws a RangeError for an invalid impulse.
 */
export function applyCharacterImpulse(
  world: World<never>,
  entity: EntityId,
  impulse: CharacterImpulse,
): boolean {
  const state = world.get(entity, CharacterController);
  if (state === undefined) return false;
  world.set(entity, CharacterController, impelCharacter(state, impulse));
  return true;
}

/**
 * Lets force stimuli push characters: every `impulseApplied` on an entity with a CharacterController
 * becomes its velocity change, sourced by the stimulus's source and staggering unless the character
 * pushed itself (a self-cast Gust keeps its reduced air control). The stimulus reaches a character
 * like any object, by its properties: pushable or liftable, with a weight. Returns the unsubscribe.
 */
export function installCharacterImpulses(world: World<never>): () => void {
  return world.events.on(impulseApplied, ({ entity, velocityChange, source }) => {
    applyCharacterImpulse(world, entity, {
      velocity: velocityChange,
      source,
      stagger: source !== entity,
    });
  });
}
