// Charged moves (mw-e04.13): holding the button that started a chargeable move (the knight's heavy)
// holds its windup and builds a charge; letting go swings with damage, poise, impact force, world
// impact and stamina lerped from the uncharged move towards the charged move's full-charge values.
//
// Data. A charged move (content `charge`, e.g. sword-heavy-charged) names the move it charges
// (`from`, sword-heavy) and has its frames; its numbers are the full charge. `minHoldTicks`,
// `fullHoldTicks`, `autoReleaseTicks` and `holdTick` say how holding plays (all sim ticks).
//
// Holding (the action timeline runs it, timeline.ts). A move that has a charged variant, started by a
// request that holds (a press of its bound button, or `requestMove(…, { hold: true })`), starts
// holding: `hold.held` is 1 on its first tick (the press) and grows by one on every later local tick
// its button is still down. The move plays its startup as usual but stops on `holdTick` (the top of the
// swing) while held. On the tick `held` reaches `fullHoldTicks` the timeline emits ChargeReady, once.
// Letting go (the bound button is up, or `releaseCharge`) — or `held` reaching `autoReleaseTicks` —
// releases on that tick with ChargeReleased and the swing plays on from where it stood:
//
// - held < minHoldTicks: the uncharged move (a normal heavy);
// - otherwise the charged move with charge level t = (held − min) / (full − min), at most 1, so a hold
//   of 12 ticks swings a heavy's numbers under the charged move's id and 60 or more the full charge.
//
// Stamina: the uncharged cost is spent when the move starts (the timeline's rule); the extra the charge
// costs (charged cost − uncharged cost, 10 for the knight) drains as t grows, so a full charge has cost
// 25 + 10 and the regen pause holds while it builds. A drained pool does not stop the charge.
//
// Hyperarmor: the charge holds on a tick inside the move's hyperarmor window, so the hyperarmor rule
// (reactions.ts) absorbs hits on a charging knight up to its cap; the hit that breaks it staggers the
// knight, which interrupts the move, and the charge is lost with it. A released charge keeps the soak
// it had (the move's run is the same: same startedAt).
//
// Consumers read a charged hit through `chargedMove`: the melee strikes (damage packets, world
// impact) ask `effectiveMove` for the move as the attacker performs it right now.

import type { DamageTemplate, MoveTable, RuntimeMove } from '@content/index';
import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { ActionTimelineComponent } from './components';

/** A chargeable move's charged variant and the hold rules, keyed by the uncharged move's id. */
export type ChargeIndex = ReadonlyMap<string, RuntimeMove>;

/**
 * Every move in `moves` that can be charged, mapped to its charged variant. Throws a RangeError when a
 * charged move's frames differ from its uncharged move's, or its holdTick is not in that startup.
 */
export function chargeIndex(moves: MoveTable): ChargeIndex {
  const index = new Map<string, RuntimeMove>();
  for (const move of moves.values()) {
    const { charge } = move;
    if (charge === null) continue;
    const from = moves.get(charge.from);
    if (from === undefined) {
      throw new RangeError(`charged move "${move.id}" charges "${charge.from}", not in the table`);
    }
    if (from.totalTicks !== move.totalTicks || from.activeFrom !== move.activeFrom) {
      throw new RangeError(`charged move "${move.id}" must have the frames of "${from.id}"`);
    }
    if (charge.holdTick >= from.activeFrom) {
      throw new RangeError(`charged move "${move.id}" must hold before "${from.id}" turns active`);
    }
    index.set(from.id, move);
  }
  return index;
}

/** The hold rules of `charged` (a move with a `charge`). */
function rulesOf(charged: RuntimeMove): NonNullable<RuntimeMove['charge']> {
  const { charge } = charged;
  if (charge === null) throw new RangeError(`move "${charged.id}" is not a charged move`);
  return charge;
}

/**
 * The charge level 0–1 a hold of `held` ticks reaches for `charged`: 0 up to minHoldTicks, 1 from
 * fullHoldTicks, linear between.
 */
export function chargeLevel(charged: RuntimeMove, held: number): number {
  const { minHoldTicks: min, fullHoldTicks: full } = rulesOf(charged);
  if (held >= full) return 1;
  if (held <= min) return 0;
  return (held - min) / (full - min);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpDamage(from: DamageTemplate | null, to: DamageTemplate, t: number): DamageTemplate {
  if (from === null) return to;
  const amounts: Record<string, number> = {};
  const types = new Set([...Object.keys(from.amounts), ...Object.keys(to.amounts)]);
  for (const type of [...types].sort()) {
    const key = type as keyof DamageTemplate['amounts'];
    amounts[type] = lerp(from.amounts[key] ?? 0, to.amounts[key] ?? 0, t);
  }
  return Object.freeze({
    ...to,
    amounts: Object.freeze(amounts),
    poiseDamage: lerp(from.poiseDamage, to.poiseDamage, t),
    staminaDamage: lerp(from.staminaDamage, to.staminaDamage, t),
    impactForce: lerp(from.impactForce, to.impactForce, t),
    impulse: Object.freeze({
      x: lerp(from.impulse.x, to.impulse.x, t),
      y: lerp(from.impulse.y, to.impulse.y, t),
      z: lerp(from.impulse.z, to.impulse.z, t),
    }),
  });
}

function lerpImpact(
  from: RuntimeMove['worldImpact'],
  to: NonNullable<RuntimeMove['worldImpact']>,
  t: number,
): NonNullable<RuntimeMove['worldImpact']> {
  // A weight limit (mw-e04.14) is the charged move's own, not lerped.
  const { maxWeight, ...kinds } = to;
  const impact: Record<string, number> = maxWeight === undefined ? {} : { maxWeight };
  for (const [kind, energy] of Object.entries(kinds)) {
    const key = kind as keyof typeof kinds;
    impact[kind] = lerp(from?.[key] ?? 0, energy ?? 0, t);
  }
  return Object.freeze(impact);
}

/**
 * `charged` at charge level `level` (0–1): its damage template, world impact and stamina cost lerped
 * from its uncharged move's (level 0) to its own (level 1). Everything else is the charged move's.
 */
export function chargedMove(moves: MoveTable, charged: RuntimeMove, level: number): RuntimeMove {
  const from = moves.get(rulesOf(charged).from);
  if (from === undefined || level >= 1) return charged;
  const t = Math.max(0, level);
  const { damage, worldImpact } = charged;
  return Object.freeze({
    ...charged,
    staminaCost: lerp(from.staminaCost, charged.staminaCost, t),
    damage: damage === null ? null : lerpDamage(from.damage, damage, t),
    ...(worldImpact !== undefined && { worldImpact: lerpImpact(from.worldImpact, worldImpact, t) }),
  });
}

/**
 * `move` as `entity` performs it now: when it is the entity's running move released at a charge
 * level, `chargedMove` of that level; otherwise `move` itself.
 */
export function effectiveMove(
  world: World<never>,
  moves: MoveTable,
  entity: EntityId,
  move: RuntimeMove,
): RuntimeMove {
  const current = world.get(entity, ActionTimelineComponent)?.current ?? null;
  const level = current?.move === move.id ? current.charge : undefined;
  return level === undefined ? move : chargedMove(moves, move, level);
}
