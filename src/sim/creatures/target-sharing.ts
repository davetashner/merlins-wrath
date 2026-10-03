// Sharing targets in a fight (mw-e11.13): a creature's `share-target` step (AiTargetShared) reaches
// its allies near it, who hear it as a second-hand report of where the target is (awareness.ts
// `hearReport`: at the sharer's confidence × the memory tuning's `secondHand`, never overriding a
// surer memory of their own). So a guard that loses sight of the thief behind a pillar keeps
// swinging at where its partner sees the thief, and a searcher searches where the fight was.
//
// Who hears: every other creature with a brain within `radius` metres of the sharer (centre to
// centre) that regards the sharer as an ally or a friend (faction relations) and is already
// fighting or hunting — in Combat, Alerted or Searching. Raising the alarm among calm allies is
// mw-e11.12's (shouts, sight signals, alarm devices), not this. Listeners hear in ascending entity
// id. This is the world's plumbing, outside agent code: it reads where creatures stand, which agent
// code may not (no omniscience, mw-e11.8).
//
// The radius is PLACEHOLDER, to tune in play (mw-e11.16).

import type { AlertState } from '@content/index';
import { hearReport } from '../ai/awareness';
import { AiTargetShared, BrainComponent } from '../ai/components';
import type { World } from '../core/world';
import { relation } from '../factions/runtime';
import { isFriendlyStance } from '../factions/stance';
import type { FactionTable } from '../factions/table';
import { PlacementComponent } from '../stimulus/placement';

/** Metres within which allies hear a shared target, by default (PLACEHOLDER). */
export const DEFAULT_SHARE_RADIUS_M = 15;

/** The alert states in which a creature takes a shared target. */
export const SHARE_STATES: readonly AlertState[] = Object.freeze([
  'combat',
  'alerted',
  'searching',
]);

/** How target sharing is wired to a world. */
export interface TargetSharingOptions {
  /** The faction table relations are read from. */
  readonly factions: FactionTable;
  /** Metres within which allies hear it; default DEFAULT_SHARE_RADIUS_M. */
  readonly radius?: number;
}

/**
 * Delivers every AiTargetShared in `world` to the sharer's allies (see the file header). Install it
 * with AI. Returns a function that uninstalls it.
 */
export function installTargetSharing(
  world: World<never>,
  options: TargetSharingOptions,
): () => void {
  const radius = options.radius ?? DEFAULT_SHARE_RADIUS_M;
  return world.events.on(AiTargetShared, ({ entity, source, position, confidence }) => {
    const from = world.get(entity, PlacementComponent);
    if (from === undefined) return;
    world.query(BrainComponent, PlacementComponent).forEach((listener, brain, at) => {
      if (listener === entity || !SHARE_STATES.includes(brain.state)) return;
      const dx = at.x - from.x;
      const dy = at.y - from.y;
      const dz = at.z - from.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) return;
      if (!isFriendlyStance(relation(world, options.factions, listener, entity))) return;
      hearReport(world, listener, { source, position, confidence, kind: 'seen-target' });
    });
  });
}
