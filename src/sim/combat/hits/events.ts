// The events the hit-volume system emits (mw-e04.2). Whoever opened the hitbox (the action timeline,
// knight attacks, creature attacks) turns HitboxHit into damage — `hitPacket` builds the packet — so
// hit detection stays one query every attacker shares. A hit on an invulnerable target (a dodge's
// i-frames, mw-e04.8, or wake-up i-frames, mw-e04.30) is DodgedHit instead, which nothing turns into
// damage; the creature attack executor emits it too (mw-e04.28).

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

/**
 * A hitbox struck a target during its invulnerability frames (dodge or wake-up): no damage, poise or hit
 * reaction follows. Feedback (a whoosh, a "dodged" flash) and telemetry listen for it. Emitted once
 * per hitbox, target and active window: a dodged swing cannot hit that target later in its window.
 */
export const DodgedHit = defineEvent<HitboxHitInfo>('DodgedHit');
