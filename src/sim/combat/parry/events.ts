// Events the parry rules emit (mw-e04.12). The deflected hit itself is an ordinary DamageApplied of 0
// damage tagged `parried`, so the HUD and hit reactions need no second channel; HitParried is the
// parry itself — the ring audio plays (e28.16, at a voice priority nothing steals), VFX flashes and AI
// learns its swing was read. The sim has already locked the attacker's timeline for the stun.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';

/** Payload of HitParried. */
export interface ParryInfo {
  readonly tick: number;
  /** The fighter whose parry deflected the hit. */
  readonly entity: EntityId;
  /** Whose swing was parried (the packet's instigator), or null for a hit nobody swung. */
  readonly attacker: EntityId | null;
  readonly source: EntityId | null;
  /** Ticks the attacker is Parried (0 when there was no attacker to stun). */
  readonly parriedTicks: number;
}

/** A parryable hit landed in a parry window and was deflected. */
export const HitParried = defineEvent<ParryInfo>('HitParried');
