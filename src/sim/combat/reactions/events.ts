// Events of the hit-reaction rules (mw-e04.7). Render picks the reaction clip and its side from
// HitReaction (the animation parameters `hitReaction`/`hitDirection` also carry it), audio plays the
// reaction's cue, AI learns its target is open — none of them poll.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { HitDirection, HitReactionKind } from './components';

/** Why a hit that could have caused a reaction caused none. */
export type ReactionSuppression =
  'hyperarmor' | 'invulnerable' | 'weaker' | 'replaced' | 'blocked' | null;

/** Payload of HitReaction. */
export interface HitReactionInfo {
  readonly tick: number;
  readonly entity: EntityId;
  /** The reaction chosen; none when hyperarmor absorbed the hit or nothing was strong enough. */
  readonly reaction: HitReactionKind;
  readonly direction: HitDirection;
  /** Ticks it holds the entity (0 for none). */
  readonly ticks: number;
  /** It interrupted the entity's move. */
  readonly interrupted: boolean;
  /** The push went through physics (a knockback or knockdown with an impulse). */
  readonly displaced: boolean;
  /** Why the hit caused no reaction when it could have (see ReactionSuppression), else null. */
  readonly suppressed: ReactionSuppression;
  readonly instigator: EntityId | null;
  readonly source: EntityId | null;
}

/** A hit on an entity that reacts to hits was resolved into a reaction (none included). */
export const HitReaction = defineEvent<HitReactionInfo>('HitReaction');

/** Payload of HitReactionEnded. */
export interface HitReactionEndInfo {
  readonly tick: number;
  readonly entity: EntityId;
  readonly reaction: Exclude<HitReactionKind, 'none'>;
  /** First tick it is no longer invulnerable (after a knockdown's wake-up), or null. */
  readonly iframesUntil: number | null;
}

/** A reaction ran its course (a knockdown: the entity wakes up, invulnerable for a while). */
export const HitReactionEnded = defineEvent<HitReactionEndInfo>('HitReactionEnded');
