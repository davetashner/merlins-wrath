// Events the bow system emits (mw-e05.3). Animation plays the draw and aim from BowDrawStarted to
// BowDrawEnded, audio its creak and release (mw-e28.7), the HUD the quiver. A draw that looses an
// arrow ends `fired`, after the arrow's own ArrowFired (src/sim/combat/arrows); every other end
// returns the nocked arrow to the quiver.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';

/** Payload of BowDrawStarted. */
export interface BowDrawStartInfo {
  readonly tick: number;
  readonly entity: EntityId;
  /** Arrow content id nocked. */
  readonly arrow: string;
}

/** An archer started drawing (the arrow left the quiver and stamina was spent). */
export const BowDrawStarted = defineEvent<BowDrawStartInfo>('BowDrawStarted');

/**
 * How a draw ended: `fired` — released at or past the minimum draw, the arrow loosed; `early` —
 * released before the minimum draw; `collapsed` — held at full draw until stamina ran out;
 * `interrupted` — a dodge, a block, any move or a hit reaction took over (or no input came);
 * `stowed` — the bow was put away.
 */
export type BowDrawEndReason = 'fired' | 'early' | 'collapsed' | 'interrupted' | 'stowed';

/** Payload of BowDrawEnded. */
export interface BowDrawEndInfo {
  readonly tick: number;
  readonly entity: EntityId;
  readonly arrow: string;
  readonly reason: BowDrawEndReason;
  /** Ticks it was drawn. */
  readonly ticks: number;
  /** Draw fraction, 0–1 (1 at full draw). */
  readonly fraction: number;
  /** The loosed arrow's entity and launch speed (m/s), when `fired`. */
  readonly projectile?: EntityId;
  readonly speed?: number;
}

/** A draw ended (see BowDrawEndReason); every reason but `fired` returned the arrow. */
export const BowDrawEnded = defineEvent<BowDrawEndInfo>('BowDrawEnded');

/** Payload of BowEquipped. */
export interface BowEquipInfo {
  readonly tick: number;
  readonly entity: EntityId;
  /** Whether the bow is now out. */
  readonly equipped: boolean;
}

/** The bow came out or was put away. */
export const BowEquipped = defineEvent<BowEquipInfo>('BowEquipped');

/** Payload of ArrowSelected. */
export interface ArrowSelectInfo {
  readonly tick: number;
  readonly entity: EntityId;
  readonly arrow: string;
  /** How many of it the quiver holds. */
  readonly count: number;
}

/** The cycle input selected another arrow type. */
export const ArrowSelected = defineEvent<ArrowSelectInfo>('ArrowSelected');
