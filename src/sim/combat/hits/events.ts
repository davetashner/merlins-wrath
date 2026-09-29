// The event the hit-volume system emits (mw-e04.2). Whoever opened the hitbox (the action timeline,
// knight attacks, creature attacks) turns it into damage — `hitPacket` builds the packet — so hit
// detection stays one query every attacker shares.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { Vec3 } from '../../stimulus/shapes';
import type { HitRegion } from './components';

/** Payload of HitboxHit. */
export interface HitboxHitInfo {
  /** World tick of the sweep that struck. */
  readonly tick: number;
  readonly attacker: EntityId;
  /** The hitbox's id. */
  readonly hitbox: string;
  /** Active tick (1-based) of the sweep that struck. */
  readonly activeTick: number;
  readonly target: EntityId;
  /** The hurtbox that won region priority. */
  readonly hurtbox: string;
  readonly region: HitRegion;
  readonly multiplier: number;
  readonly armored: boolean;
  /** Unit horizontal direction the attacker committed to (the hit's direction). */
  readonly direction: Vec3;
}

/** A hitbox struck a target: emitted once per hitbox, target and active window. */
export const HitboxHit = defineEvent<HitboxHitInfo>('HitboxHit');
