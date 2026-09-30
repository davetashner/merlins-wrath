// Hit-stop (mw-e04.11): a few ticks of freeze when a blade connects, the biggest single contributor
// to the weight of a hit. Only the attacker and the entity it struck freeze, in their local time (the
// action timeline's `setTimeScale(…, 0, ticks)`): other entities, projectiles, physics and the world
// clock keep running, so a third fighter's swing lands on time.
//
// Lengths come from content (the hit-stop table, PLACEHOLDER tuning: light 3, heavy 5, charged 6,
// parry 8, critical 10) by the tier of the move that hit (`RuntimeMove.hitStop`, light by default).
// A blocked hit freezes too: the blade met the shield. A dodged hit (DodgedHit) does not.
//
// Timing. A hit on world tick T (the hit-volume system runs after the action timeline, so both
// timelines have already run on T) freezes their next `ticks` timeline runs: ticks T+1 … T+ticks. The
// timeline's own state shows it from T: its time scale reads 0 after ticks T … T+ticks−1 and 1 again
// after T+ticks, which is what animation (its local time scale) and the overlay read between steps. A
// heavy connecting on tick 20 freezes both on ticks 20–24 and they resume on tick 25; each move ends
// exactly 5 ticks later than it would have.
//
// Stacking. Overlapping freezes take the longest, never the sum: a hit only lengthens a freeze whose
// remaining ticks are fewer than its own (a victim with 3 ticks left, hit by a parry-tier event, is
// frozen for 8 more, not 11), so one swing striking three enemies on one tick freezes the attacker
// once. HitStopStarted is emitted only when a freeze starts or lengthens.
//
// What follows local time. While an entity is frozen (`isHitStopped`), the hit-volume system does not
// sweep its open hitboxes (each active tick of the move still sweeps once, on the tick the move
// reaches it), and its hit reaction does not age: a reaction's end, and a knockdown's wake-up
// i-frames, move one tick later per frozen tick, so the reaction ends on the tick the timeline's
// interrupt lock runs out. Hit-stop owns the entity's time scale while it lasts: a freeze replaces a
// slow-down and returns the entity to normal speed, and an open-ended freeze set by someone else
// (`setTimeScale(…, 0)` without a duration) is left alone.

import type { HitStopTable, HitStopTier, MoveTable } from '@content/index';
import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { HitboxHit } from '../hits/events';
import { ActionTimelineComponent } from '../timeline/components';
import { setTimeScale } from '../timeline/timeline';
import { HitStopComponent } from './components';
import { HitStopStarted } from './events';

/** Timeline runs `entity` stays frozen for after this tick (Infinity for an open-ended freeze). */
function frozenLeft(world: World<never>, entity: EntityId): number {
  const timeline = world.get(entity, ActionTimelineComponent);
  if (timeline?.timeScale !== 0) return 0;
  return timeline.scaleTicks ?? Number.POSITIVE_INFINITY;
}

/**
 * Freezes `entity` for `ticks` timeline runs after this tick unless it is already frozen at least
 * that long (see the file header), recording the freeze and emitting HitStopStarted. Call it after
 * the action timeline has run this tick, as hits are. Returns whether it started or lengthened a
 * freeze; an entity without an action timeline has nothing to freeze. Throws a RangeError for a
 * `ticks` that is not a whole number ≥ 0.
 */
export function applyHitStop(
  world: World<never>,
  entity: EntityId,
  tier: HitStopTier,
  ticks: number,
  instigator: EntityId | null = null,
): boolean {
  if (!(Number.isSafeInteger(ticks) && ticks >= 0)) {
    throw new RangeError(`hit-stop must be a whole number of ticks ≥ 0, got ${String(ticks)}`);
  }
  if (!world.has(entity, ActionTimelineComponent) || ticks <= frozenLeft(world, entity)) {
    return false;
  }
  setTimeScale(world, entity, 0, ticks);
  const tick = world.tick;
  const until = tick + ticks;
  const previous = world.get(entity, HitStopComponent);
  // A freeze lengthened (or continued on its last tick) stays one freeze, from its first tick.
  const from = previous !== undefined && previous.until >= tick ? previous.from : tick + 1;
  const state = Object.freeze({ tier, startedAt: tick, from, until });
  if (previous === undefined) world.add(entity, HitStopComponent, state);
  else world.set(entity, HitStopComponent, state);
  world.events.emit(HitStopStarted, { tick, entity, tier, ticks, until, instigator });
  return true;
}

/** What `installHitStop` needs. */
export interface HitStopOptions {
  /** Every move that can hit (the action timeline's table): the tier of each hitbox's move. */
  readonly moves: MoveTable;
  /** Freeze ticks per tier (`compileHitStop` of the hit-stop content). */
  readonly table: HitStopTable;
}

/**
 * Wires hit-stop into `world`: each HitboxHit of a move's hitbox (hitbox ids are move ids) freezes
 * the attacker, then the entity struck, for the move's tier. Register HitStopComponent and the
 * action timeline components first. Returns a function that removes the subscription.
 */
export function installHitStop<TInput>(world: World<TInput>, options: HitStopOptions): () => void {
  const { moves, table } = options;
  const w: World<never> = world;
  return world.events.on(HitboxHit, ({ attacker, target, hitbox }) => {
    const tier = moves.get(hitbox)?.hitStop ?? null;
    if (tier === null) return;
    const ticks = table[tier];
    applyHitStop(w, attacker, tier, ticks, attacker);
    applyHitStop(w, target, tier, ticks, attacker);
  });
}
