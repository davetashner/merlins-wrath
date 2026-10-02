// Events the melee rules emit (mw-e04.6). A blocked hit is an ordinary DamageApplied tagged
// `blocked` (and `guard-break` when it broke the guard), so impact audio and the HUD need no second
// channel; the guard break itself is GuardBroken, which hit reactions (e04.7), animation and audio
// turn into the stagger they show. The sim has already locked the blocker's timeline for the stagger.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { DamageResult } from '../damage/events';

/** Payload of GuardBroken. */
export interface GuardBreak {
  readonly tick: number;
  /** The blocker whose stamina ran out. */
  readonly entity: EntityId;
  /** Who struck the breaking hit (the packet's instigator). */
  readonly instigator: EntityId | null;
  readonly source: EntityId | null;
  /** Ticks the blocker is staggered (its action timeline is locked for them). */
  readonly staggerTicks: number;
}

/**
 * A blocked hit emptied the blocker's stamina: the shield drops, the blocker is staggered for
 * `staggerTicks`, and the hit's unabsorbed remainder lands (in the DamageApplied that follows).
 */
export const GuardBroken = defineEvent<GuardBreak>('GuardBroken');

/** Payload of MoveStruck. */
export interface MoveStrike {
  readonly tick: number;
  /** Whose move struck (the hitbox's owner). */
  readonly attacker: EntityId;
  /** The move (its hitbox id). */
  readonly move: string;
  readonly target: EntityId;
  /** The damage model's result for the move's packet, or null when it resolved nothing (no combatant). */
  readonly result: DamageResult | null;
}

/**
 * A move's hit volume struck a target and its packet went through the damage model (mw-e04.20): the
 * creature attack executor adds its extra packets and reports AttackHit from here. Emitted after the
 * hit's DamageApplied is queued, so it carries the same result.
 */
export const MoveStruck = defineEvent<MoveStrike>('MoveStruck');
