// The event the hit-stop rule emits (mw-e04.11). Presentation syncs to it: impact audio and VFX start
// on the first frozen frame, the frame-data overlay counts the freeze down. It is sim output like
// every other event, so a replay shows the same freezes on the same ticks.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { HitStopTier } from './components';

/** Payload of HitStopStarted. */
export interface HitStopInfo {
  /** World tick of the hit. */
  readonly tick: number;
  /** The entity frozen (the attacker, or the one it struck). */
  readonly entity: EntityId;
  readonly tier: HitStopTier;
  /** Timeline runs it is frozen for from now: world ticks tick + 1 … until. */
  readonly ticks: number;
  /** Last frozen world tick. */
  readonly until: number;
  /** Who struck the hit (the attacker, also on the attacker's own freeze), or null. */
  readonly instigator: EntityId | null;
}

/**
 * A hit froze `entity`, or lengthened its freeze. Emitted once per entity and hit tick however many
 * targets one swing strikes, and not at all for a hit whose freeze is no longer than the one left.
 */
export const HitStopStarted = defineEvent<HitStopInfo>('HitStopStarted');
