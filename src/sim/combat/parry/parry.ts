// Parry and riposte (mw-e04.12): the knight's mastery verb. High risk, high reward, readable windows.
//
// The parry is a move (verb `parry`, e.g. the knight's `shield-parry`: 30 ticks, 10 stamina) whose
// active ticks are its window: ticks 4–13 for the knight. The window is data, so progression (e19)
// can widen it, and the player's DifficultyConfig `parryWindow` scales its length from its first
// tick (`parryWindowOf`: ×2.0 makes 4–23, clamped to the move), the way `dodgeWindow` scales i-frames.
//
// Deflection (`parryGuard`, the damage model's guard stage). A hit tagged `parryable` (melee strikes
// tag every hit of a parryable move) that lands while its target's parry is in its window — and, for
// a target with a shield, comes from inside the shield's frontal arc — is parried: it deals 0 damage,
// 0 poise and 0 stamina damage and is tagged `parried`, so the DamageApplied that follows shows the
// deflection and hit reactions play none. Its attacker (the packet's instigator), if it has an action
// timeline, is **Parried**: its move is interrupted (its hitbox closes) and its timeline locked for
// PARRIED_TICKS (90, 1.5 s). Both fighters freeze for the hit-stop table's `parry` tier (8 ticks) and
// HitParried is emitted. Hits without the tag — unparryable moves, grabs, most spells, falls — pass
// through the window as ordinary hits.
//
// Counter-hits (`counterHitModifier`, the attacker stage). A parry that deflected nothing is
// vulnerable after its window: a hit on ticks 14–29 of the knight's parry deals ×COUNTER_HIT_MULTIPLIER
// (1.25) damage and is tagged `counter`. A parry that deflected something has no counter window.
//
// Riposte. While a Parried fighter stands within RIPOSTE_RANGE (2.0 m, horizontally between
// placements) of a fighter and inside its frontal RIPOSTE_ARC_DEGREES (60°) of its combat facing, that
// fighter's light attack starts its riposte move instead (`riposteRedirect`, the action timeline's
// redirect), which turns it to face the nearest such target as it starts. Riposte hits (tagged
// `riposte` by the move's data) deal ×RIPOSTE_DAMAGE_MULTIPLIER (3) damage, are tagged `critical`,
// ignore poise (a critical always staggers, whatever the target's poise meter or hyperarmor: the hit
// reactions' rule) and end the target's Parried stun. The riposte move's own i-frames cover its whole
// duration.
//
// Timing. A parry pressed on world tick 0 starts on tick 0, so a hit landing on tick 4 or 13 is
// parried and one on tick 3 or 14 is not (hits land after the action timeline has run). The Parried
// stun of a parry on tick T lasts ticks T+1 … T+90 counted in the attacker's local time, like its
// timeline lock: each tick hit-stop freezes it moves the end one tick later, so it ends on the tick
// the lock runs out (after the 8-tick parry freeze: T+98).
//
// Numbers in the bead are constants here; everything else (the riposte's frames, reach and base
// damage) is move data.

import type { HitStopTable, MoveTable, RuntimeMove, TickRange } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { cos } from '../../math';
import { PlacementComponent } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { PlayerCombatantComponent } from '../damage/components';
import { scaleDamage, type DamageModel, type DamageModifier } from '../damage/model';
import { DAMAGE_TAGS, type DamagePacket } from '../damage/packet';
import type { DamageAmounts } from '../damage/types';
import { isHitStopped } from '../hitstop/components';
import { applyHitStop } from '../hitstop/hitstop';
import { CombatFacingComponent, facingOf, giveFacing, GuardComponent } from '../melee/components';
import { inGuardArc } from '../melee/guard';
import { ActionTimelineComponent } from '../timeline/components';
import { ActionStarted } from '../timeline/events';
import { actionOf, interruptAction, type MoveRedirect } from '../timeline/timeline';
import { deflectedRun, isParried, parriedOf, ParryComponent, updateParry } from './components';
import { HitParried } from './events';

/** How long a parried attacker is stunned (mw-e04.12): 90 ticks, 1.5 s. */
export const PARRIED_TICKS = 90;

/** Damage multiplier of a counter-hit into a failed parry's recovery. */
export const COUNTER_HIT_MULTIPLIER = 1.25;

/** Damage multiplier of a riposte (a critical): 3× the move's base damage. */
export const RIPOSTE_DAMAGE_MULTIPLIER = 3;

/** How close a Parried target must be for a riposte, metres (horizontal, placement to placement). */
export const RIPOSTE_RANGE = 2.0;

/** Width of the frontal arc a Parried target must be in for a riposte, degrees. */
export const RIPOSTE_ARC_DEGREES = 60;

/** Slack on the arc's edge, so a target exactly on it is inside. */
const ARC_EPSILON = 1e-9;

/**
 * The parry window of `move` with the difficulty's `parryWindow` multiplier applied (1 leaves it as
 * authored: its active ticks), or null when `move` is not a parry. The length is scaled from the
 * window's first tick, at least 1 tick and never past the move's last tick.
 */
export function parryWindowOf(move: RuntimeMove, parryWindow = 1): TickRange | null {
  if (move.verb !== 'parry' || move.active === 0) return null;
  const length = Math.max(1, Math.round(move.active * parryWindow));
  return Object.freeze({
    from: move.activeFrom,
    to: Math.min(move.activeFrom + length - 1, move.totalTicks - 1),
  });
}

/**
 * Where a fighter's parry is: `startup` before its window, `window` while it deflects, then
 * `counter` (it deflected nothing: hits are counter-hits) or `recovery` (it deflected a hit).
 */
export type ParryPhase = 'startup' | 'window' | 'counter' | 'recovery';

/**
 * The phase of the parry `entity` is performing this tick (see ParryPhase), or undefined when it is
 * not parrying (or has no action timeline). The player's window is scaled by the difficulty.
 */
export function parryPhaseOf(
  world: World<never>,
  entity: EntityId,
  moves: MoveTable,
): ParryPhase | undefined {
  if (!world.isRegistered(ActionTimelineComponent)) return undefined;
  const current = actionOf(world, entity);
  const move = current === undefined ? undefined : moves.get(current.move);
  if (current === undefined || move === undefined) return undefined;
  const player =
    world.isRegistered(PlayerCombatantComponent) && world.has(entity, PlayerCombatantComponent);
  const window = parryWindowOf(move, player ? world.difficulty.parryWindow : 1);
  if (window === null) return undefined;
  if (current.tick < window.from) return 'startup';
  if (current.tick <= window.to) return 'window';
  return deflectedRun(world, entity) === current.startedAt ? 'recovery' : 'counter';
}

/** Every type of `amounts` at 0 (a deflected hit still names what it would have dealt). */
function nothing(amounts: DamageAmounts): DamageAmounts {
  return Object.fromEntries(Object.keys(amounts).map((type) => [type, 0]));
}

/** What the parry rules need. */
export interface ParryOptions {
  /** Every move the fighters may perform (the action timeline's table). */
  readonly moves: MoveTable;
  /**
   * Ticks a parry freezes both fighters (the hit-stop table's `parry` tier); 0 or absent = no
   * freeze. With a freeze, register HitStopComponent.
   */
  readonly hitStopTicks?: number;
}

/** Deflects `packet` on `target` (see the file header): the stun, the freeze and HitParried. */
function deflect(
  world: World<never>,
  target: EntityId,
  packet: DamagePacket,
  startedAt: number,
  hitStopTicks: number,
): void {
  const tick = world.tick;
  updateParry(world, target, { deflected: startedAt });
  const attacker = packet.instigator;
  const stuns =
    attacker !== null && attacker !== target && world.has(attacker, ActionTimelineComponent);
  if (stuns) {
    interruptAction(world, attacker, PARRIED_TICKS);
    updateParry(world, attacker, {
      parried: Object.freeze({ by: target, startedAt: tick, endsAt: tick + 1 + PARRIED_TICKS }),
    });
  }
  if (hitStopTicks > 0) {
    if (attacker !== null) applyHitStop(world, attacker, 'parry', hitStopTicks, attacker);
    applyHitStop(world, target, 'parry', hitStopTicks, attacker);
  }
  world.events.emit(HitParried, {
    tick,
    entity: target,
    attacker,
    source: packet.source,
    parriedTicks: stuns ? PARRIED_TICKS : 0,
  });
}

/**
 * The parry rule for the damage model's guard stage (see the file header). Register it once on the
 * world's DamageModel (`installParry` does). Needs the action timeline components registered, and the
 * melee ones for fighters with shields.
 */
export function parryGuard(options: ParryOptions): DamageModifier {
  const { moves, hitStopTicks = 0 } = options;
  return {
    name: 'parry',
    stage: 'guard',
    apply: (hit, { world, target, packet }) => {
      if (!packet.tags.includes(DAMAGE_TAGS.parryable)) return undefined;
      if (parryPhaseOf(world, target, moves) !== 'window') return undefined;
      const guard = world.isRegistered(GuardComponent)
        ? world.get(target, GuardComponent)
        : undefined;
      const { direction } = packet;
      if (guard !== undefined && direction !== undefined) {
        if (!inGuardArc(guard, facingOf(world, target), direction)) return undefined;
      }
      // parryPhaseOf found a running parry.
      const startedAt = (actionOf(world, target) as { readonly startedAt: number }).startedAt;
      deflect(world, target, packet, startedAt, hitStopTicks);
      return {
        amounts: nothing(hit.amounts),
        poiseDamage: 0,
        staminaDamage: 0,
        tags: [...hit.tags, DAMAGE_TAGS.parried],
      };
    },
  };
}

/**
 * The counter-hit rule for the damage model's attacker stage: a hit on a fighter whose parry
 * deflected nothing and is past its window deals ×COUNTER_HIT_MULTIPLIER and is tagged `counter`.
 * Environmental damage and a fighter's harm to itself are never counter-hits.
 */
export function counterHitModifier(moves: MoveTable): DamageModifier {
  return {
    name: 'counter-hit',
    stage: 'attacker',
    apply: (hit, { world, target, packet }) => {
      if (packet.instigator === target || packet.tags.includes(DAMAGE_TAGS.environment)) {
        return undefined;
      }
      if (parryPhaseOf(world, target, moves) !== 'counter') return undefined;
      return {
        ...hit,
        amounts: scaleDamage(hit.amounts, COUNTER_HIT_MULTIPLIER),
        tags: [...hit.tags, DAMAGE_TAGS.counter],
      };
    },
  };
}

/**
 * The riposte rule for the damage model's attacker stage: a hit tagged `riposte` deals
 * ×RIPOSTE_DAMAGE_MULTIPLIER, is tagged `critical`, and ends its target's Parried stun.
 */
export function riposteModifier(): DamageModifier {
  return {
    name: 'riposte',
    stage: 'attacker',
    apply: (hit, { world, target, tick }) => {
      if (!hit.tags.includes(DAMAGE_TAGS.riposte)) return undefined;
      const stun = parriedOf(world, target, tick);
      if (stun !== undefined) {
        const { by, startedAt } = stun;
        updateParry(world, target, { parried: Object.freeze({ by, startedAt, endsAt: tick }) });
      }
      return {
        ...hit,
        amounts: scaleDamage(hit.amounts, RIPOSTE_DAMAGE_MULTIPLIER),
        tags: [...hit.tags, DAMAGE_TAGS.critical],
      };
    },
  };
}

/**
 * The Parried fighter `entity` could riposte now: the nearest (then lowest id) Parried fighter within
 * RIPOSTE_RANGE and inside its frontal RIPOSTE_ARC_DEGREES, or undefined. Needs placements; false
 * in a world without the parry component.
 */
export function riposteTargetOf(world: World<never>, entity: EntityId): EntityId | undefined {
  if (!world.isRegistered(ParryComponent) || !world.isRegistered(PlacementComponent)) {
    return undefined;
  }
  const at = world.get(entity, PlacementComponent);
  if (at === undefined) return undefined;
  const facing = facingOf(world, entity);
  const minCos = cos(((RIPOSTE_ARC_DEGREES / 2) * Math.PI) / 180) - ARC_EPSILON;
  let best: EntityId | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  world.query(ParryComponent, PlacementComponent).forEach((other, _state, placed) => {
    if (other === entity || !isParried(world, other)) return;
    const x = placed.x - at.x;
    const z = placed.z - at.z;
    const distance = Math.sqrt(x * x + z * z);
    if (distance > RIPOSTE_RANGE || distance >= bestDistance) return;
    if (distance > 0 && (x * facing.x + z * facing.z) / distance < minCos) return;
    best = other;
    bestDistance = distance;
  });
  return best;
}

/** Which request a riposte replaces, and with what. */
export interface RiposteMoves {
  /** The move (or chain root) whose request becomes a riposte: the knight's light attack. */
  readonly trigger: string;
  /** The riposte move, e.g. `sword-riposte`. */
  readonly riposte: string;
}

/**
 * The action timeline's redirect for ripostes: a request for `trigger` starts `riposte` while the
 * requester has a riposte target (`riposteTargetOf`).
 */
export function riposteRedirect(moves: RiposteMoves): MoveRedirect {
  return (world, entity, requested) =>
    requested === moves.trigger && riposteTargetOf(world, entity) !== undefined
      ? moves.riposte
      : undefined;
}

/**
 * Extends Parried stuns frozen by hit-stop this tick by a tick (see the file header). Run it once per
 * tick, anywhere in the order.
 */
export function parriedSystem<TInput>(): System<TInput> {
  return {
    name: 'parried',
    run: ({ world }) => {
      const w: World<never> = world;
      w.query(ParryComponent).forEach((entity, state) => {
        const stun = state.parried;
        if (stun === null || w.tick >= stun.endsAt || !isHitStopped(w, entity)) return;
        const endsAt = stun.endsAt + 1;
        w.set(entity, ParryComponent, Object.freeze({ ...state, parried: { ...stun, endsAt } }));
      });
    },
  };
}

/** What `installParry` wires. */
export interface InstallParryOptions {
  /** Every move the fighters may perform (the action timeline's table). */
  readonly moves: MoveTable;
  /** The damage model hits resolve through: gets the parry, counter-hit and riposte rules. */
  readonly damage: DamageModel;
  /** Hit-stop ticks per tier: a parry freezes both fighters for its `parry` tier. Absent = none. */
  readonly hitStop?: HitStopTable;
  /** The riposte move: a fighter starting it turns to face its riposte target. */
  readonly riposte?: string;
}

/**
 * Wires parry and riposte into `world` (see the file header): registers ParryComponent if needed,
 * appends the Parried system, registers the parry (guard stage), counter-hit and riposte (attacker
 * stage) rules on `damage`, and turns a fighter starting `riposte` to face its target. Register the
 * action timeline and damage components first (and HitStopComponent with `hitStop`). The riposte
 * itself is the action timeline's `riposteRedirect`. Returns a function that removes the
 * subscription and the rules (the system stays, as systems always do).
 */
export function installParry<TInput>(
  world: World<TInput>,
  options: InstallParryOptions,
): () => void {
  const { moves, damage, hitStop, riposte } = options;
  const w: World<never> = world;
  if (!world.isRegistered(ParryComponent)) world.register(ParryComponent);
  world.addSystem(parriedSystem());
  const rules = [
    damage.register(parryGuard({ moves, hitStopTicks: hitStop?.parry ?? 0 })),
    damage.register(counterHitModifier(moves)),
    damage.register(riposteModifier()),
  ];
  const off = world.events.on(ActionStarted, ({ entity, move }) => {
    if (move !== riposte || !w.isRegistered(CombatFacingComponent)) return;
    const target = riposteTargetOf(w, entity);
    if (target === undefined) return;
    // A riposte target is only ever found between two placements.
    const from = w.get(entity, PlacementComponent) as Vec3;
    const to = w.get(target, PlacementComponent) as Vec3;
    if (to.x === from.x && to.z === from.z) return;
    giveFacing(w, entity, { x: to.x - from.x, y: 0, z: to.z - from.z });
  });
  return () => {
    off();
    for (const id of rules) damage.unregister(id);
  };
}
