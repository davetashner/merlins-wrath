// Combat behaviour (mw-e11.13): what a creature in Combat needs besides the runtime — attack
// tokens, attack selection, the out-of-reach clock, and the stagger gate. The primitives that fight
// (`strike`, `circle`, `share-target`, primitives.ts) and the combat inputs (inputs.ts) are built
// from these pieces; behaviours put them together in their Combat state (content `behaviour`).
//
// - Attack tokens. A target can be attacked by at most `attackTokens` creatures at once (AiOptions,
//   default 2): a creature takes one of its target's tokens when it starts an attack and holds it
//   until the attack ends, broken off or not. Tokens are not a store of their own: a creature holds
//   one exactly while its brain names the target it took it on (`combat.token`) and its attacker
//   has an attack in progress, so saves, despawns and cancelled swings can never leak one. Agents
//   act in ascending entity id and an attack in progress is visible within the tick it starts, so
//   no tick ever has more holders than the budget.
// - Attack selection. Of the attacks a creature knows, those whose preconditions hold at the
//   distance to where it believes its target is (`canStartAttack`: range, cooldown, health) are
//   the options; an attack whose precondition fails is never chosen. Each option weighs its
//   content weight × an aggression lean: 1 + (2 × aggression − 1) × (its length / the options'
//   mean length − 1), at least 0.1, so a bold creature favours its long, committal swings and a
//   cautious one its quick ones (aggression 0.5 leaves the weights as they are). While attacks it
//   knows are ready but out of reach, "close in" is an option too, weighing what they weigh, so a
//   creature with a short chop and a long thrust does not always open with the thrust. The roll
//   (one draw from the world's `ai` stream) is made once each time the set of usable attacks
//   changes, so standing still does not reroll every tick.
// - Out of reach. A creature that cannot path to its target (the player on a ledge) waits as close
//   as it can get; `unreachableSince` and `unreachableAt` remember since when and where the target
//   stood, and `targetUnreachableS` reads the clock. When the target moves more than
//   UNREACHABLE_MOVE_M from that spot the clock reads 0 again, so the creature tries again.
// - Staggered. A creature whose action timeline is locked (a hit reaction, a guard break, a Parried
//   stun) or that plays a stagger, knockback or knockdown does nothing: the runtime drops its
//   activity and does not choose another until the stagger ends, then chooses afresh (so a swing a
//   stagger cancelled is never resumed).
//
// Positions are the agent's own and its target memory's (no omniscience, mw-e11.8); counting
// tokens reads other agents' brains and attackers, never where anything is.

import type { RuntimeAttack } from '@content/index';
import { AttackerComponent } from '../combat/attacks/components';
import { HitReactionComponent } from '../combat/reactions/components';
import { ActionTimelineComponent } from '../combat/timeline/components';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import { BrainComponent, type Brain } from './components';
import { recall } from './memory';
import { at, getIf } from './util';
import type { AgentView } from './view';

/** How many creatures may attack one target at once, by default. */
export const DEFAULT_ATTACK_TOKENS = 2;

/** What `targetDistance` reads with no target to measure to, metres. */
export const NO_TARGET_DISTANCE = 1000;

/** Metres the target must move from where it was unreachable before the creature tries again. */
export const UNREACHABLE_MOVE_M = 1;

/** The least an aggression lean leaves of an attack's weight. */
const MIN_LEAN = 0.1;

/** What a creature remembers about its fight (`brain.combat`; absent until it first fights). */
export interface CombatMemory {
  /** The target whose attack token its attack in progress holds, or -1. */
  token: number;
  /** The tick it found its target out of reach, or -1 while it can reach it. */
  unreachableSince: number;
  /** Where it believed its target was then, or null. */
  unreachableAt: Vec3 | null;
}

/** `brain`'s combat memory, created fresh the first time it is needed. */
export function combatOf(brain: Brain): CombatMemory {
  brain.combat ??= { token: -1, unreachableSince: -1, unreachableAt: null };
  return brain.combat;
}

/** Where the agent believes its target is (its target memory's prediction), or undefined. */
export function believedTarget(v: AgentView): Vec3 | undefined {
  const { target, targetSource } = v.brain.blackboard;
  if (target === null || targetSource === null) return undefined;
  return recall(v.brain.memory, targetSource, v.tick, v.hz, v.ports.memory)?.predicted;
}

/** Metres from `a` to `b`. */
export function distance3(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The creatures (other than `except`) holding one of `target`'s attack tokens, ascending. */
export function tokenHolders(world: World<never>, target: EntityId, except = -1): EntityId[] {
  const holders: EntityId[] = [];
  world.query(BrainComponent).forEach((entity, brain) => {
    if (entity === except || brain.combat?.token !== target) return;
    if ((getIf(world, entity, AttackerComponent)?.current ?? null) !== null) holders.push(entity);
  });
  return holders;
}

/** Whether the agent holds one of its target's tokens or could take one now. */
export function hasAttackToken(v: AgentView): boolean {
  const target = v.brain.blackboard.target;
  if (target === null) return false;
  const mine =
    v.brain.combat?.token === target &&
    (getIf(v.world, v.entity, AttackerComponent)?.current ?? null) !== null;
  return mine || tokenHolders(v.world, target, v.entity).length < v.ports.attackTokens;
}

/** Seconds the agent's target has been out of its reach (see the file header). */
export function unreachableSeconds(v: AgentView): number {
  const combat = v.brain.combat;
  if (combat === undefined || combat.unreachableSince < 0) return 0;
  const now = believedTarget(v);
  const then = combat.unreachableAt;
  if (now !== undefined && then !== null && distance3(now, then) > UNREACHABLE_MOVE_M) return 0;
  return (v.tick - combat.unreachableSince) / v.hz;
}

/**
 * The selection weight of each attack in `options` for a creature of `aggression` (0–1): its
 * weight × its aggression lean (see the file header).
 */
export function attackWeights(options: readonly RuntimeAttack[], aggression: number): number[] {
  if (options.length === 0) return [];
  let total = 0;
  for (const a of options) total += a.move.totalTicks;
  const mean = total / options.length;
  const bold = 2 * aggression - 1;
  return options.map((a) => {
    const lean = mean > 0 ? 1 + bold * (a.move.totalTicks / mean - 1) : 1;
    return a.weight * Math.max(MIN_LEAN, lean);
  });
}

/**
 * The index `roll` (0 ≤ roll < 1) lands on among `weights`, in proportion to each, or -1 when no
 * weight is positive.
 */
export function pickWeighted(weights: readonly number[], roll: number): number {
  let total = 0;
  for (const w of weights) if (w > 0) total += w;
  if (!(total > 0)) return -1;
  let mark = roll * total;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = at(weights, i);
    if (!(w > 0)) continue;
    last = i;
    if (mark < w) return i;
    mark -= w;
  }
  return last;
}

/** Whether `entity` is staggered (see the file header). */
export function isStaggered(world: World<never>, entity: EntityId): boolean {
  if ((getIf(world, entity, ActionTimelineComponent)?.lockTicks ?? 0) > 0) return true;
  const reaction = getIf(world, entity, HitReactionComponent)?.current ?? null;
  return reaction !== null && reaction.kind !== 'flinch' && world.tick < reaction.endsAt;
}
