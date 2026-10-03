// Leashes (mw-e01.17): how far a creature chases from its post. A creature spawn may carry a leash, a
// radius in metres around a post (by default its spawn point; creatures/components.ts
// `CreatureLeash`), so leaving the fight room mid-combat creates a new situation, not a reset
// (constitution §2). Distances are measured on the level, from the creature's own placement and its
// own beliefs (its target memory), never from where anything really is.
//
// - The leash check (`leashBroken`, run by the runtime every tick before thinking): a creature in
//   Combat whose own distance from its post exceeds the radius drops its target (target, its memory's
//   source and whether it sees it are cleared, and its awareness of that source is forgotten; its
//   last-known position becomes where it stands, the leash edge) and enters Searching, within one
//   tick, with the cause `leash`. That is its table's own Combat → Searching move taken early: a
//   behaviour whose table lacks the move has no leash. It searches there for `leashSearchS` seconds
//   (behaviour tuning) instead of its Searching timeout, then stands down along Searching's timeout.
// - Re-acquiring (`leashAllows`): a leashed creature does not enter Combat with a target it believes
//   stands beyond the radius. A target that steps back inside is fought again by normal perception.
// - Out of Combat a leashed creature never walks past its leash: a `move-to` goal beyond the radius
//   is pulled in to the leash edge (`withinLeash`), so searching, seeking a noise or hunting never
//   takes it out of its territory; only the heat of a fight does, and the check pulls it back.
// - Home: `fromPost` (an input) is how far it stands from its post, and `post` (a step target) is
//   the post; a behaviour walks home from Unaware with them (the Forgotten's `home`). Walking home is
//   just walking: nothing heals, so it comes back with the wounds it left with.
//
// Without a leash nothing here applies: `fromPost` reads 0 and a creature chases as it always has.

import type { CreatureLeash } from '../creatures/components';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import type { CompiledBehaviour } from './behaviour';
import { believedTarget } from './combat';
import { getIf } from './util';
import type { AgentView } from './view';

/** Seconds a leashed creature searches at its leash edge when its behaviour does not say. */
export const DEFAULT_LEASH_SEARCH_S = 3;

/** The agent's leash, or undefined. */
export function leashOf(view: AgentView): CreatureLeash | undefined {
  return view.creature?.origin.leash;
}

/** Metres on the level from `point` to `leash`'s post. */
function flatFromPost(leash: CreatureLeash, point: Vec3): number {
  return Math.sqrt((point.x - leash.post.x) ** 2 + (point.z - leash.post.z) ** 2);
}

/** Metres on the level from the agent to its leash post (0 without a leash or a placement). */
export function fromPost(view: AgentView): number {
  const leash = leashOf(view);
  const here = getIf(view.world, view.entity, PlacementComponent);
  return leash === undefined || here === undefined ? 0 : flatFromPost(leash, here);
}

/**
 * Whether the agent's leash breaks now: it is in Combat beyond its radius and its behaviour's table
 * lists Combat → Searching (see the file header).
 */
export function leashBroken(view: AgentView, behaviour: CompiledBehaviour): boolean {
  const leash = leashOf(view);
  if (leash === undefined || view.brain.state !== 'combat') return false;
  if (!behaviour.leashMove) return false;
  return fromPost(view) > leash.radius;
}

/** Whether a leashed agent may enter Combat: it believes its target is within its leash. */
export function leashAllows(view: AgentView): boolean {
  const leash = leashOf(view);
  if (leash === undefined) return true;
  const target = believedTarget(view) ?? view.brain.blackboard.lkp ?? undefined;
  return target === undefined || flatFromPost(leash, target) <= leash.radius;
}

/**
 * `goal`, pulled in on the level to the agent's leash edge when it lies beyond (out of Combat only;
 * see the file header). The goal itself otherwise.
 */
export function withinLeash(view: AgentView, goal: Vec3): Vec3 {
  const leash = leashOf(view);
  if (leash === undefined || view.brain.state === 'combat') return goal;
  const d = flatFromPost(leash, goal);
  if (d <= leash.radius) return goal;
  const k = leash.radius / d;
  const { post } = leash;
  return { x: post.x + (goal.x - post.x) * k, y: goal.y, z: post.z + (goal.z - post.z) * k };
}
