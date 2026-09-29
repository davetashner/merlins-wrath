// Melee strikes (mw-e04.6): the glue that turns an action timeline's moves into swept hitboxes and
// then into damage. For every fighter that can open hitboxes (it has the hitbox component, given at
// setup with `giveHitboxes`):
//
// - when one of its moves enters its active phase, the move's hitbox opens on the move's socket track
//   (`hitboxFromMove`), committed to the fighter's facing; the hit-volume system (mw-e04.2), run after
//   the timeline in the same tick, sweeps it on each active tick, so a 12/4/18 move started on tick 0
//   can strike on ticks 12–15 only;
// - when a move ends early (cancelled or interrupted), its hitbox closes;
// - each HitboxHit of such a hitbox becomes one damage packet from the move's damage template
//   (`hitPacket`: direction, region and region multiplier from the hit; the template's impulse turned
//   from the attacker's frame into the world), tagged `unblockable` for an unblockable move, and is
//   applied through the damage model — where the shield rule (guard.ts) meets it.
//
// Hitbox ids are move ids, so the knight's `sword-light-2` is also the hitbox that struck.

import type { MoveTable } from '@content/index';
import type { World } from '../../core/world';
import { rotateToWorld } from '../attacks/frame';
import type { DamageModel } from '../damage/model';
import { DAMAGE_TAGS } from '../damage/packet';
import { closeHitboxes, HitboxComponent, openHitbox } from '../hits/components';
import { HitboxHit } from '../hits/events';
import { hitboxFromMove, hitPacket, moveTrack, type SocketTrackLookup } from '../hits/system';
import { ActionEnded, ActionPhaseChanged } from '../timeline/events';
import { facingOf } from './components';

/** What melee strikes need. */
export interface MeleeStrikeOptions {
  /** Every move the fighters may perform (`compileMoves`). */
  readonly moves: MoveTable;
  /** The socket tracks their hitboxes sweep along (`compileSocketTracks`). */
  readonly tracks: SocketTrackLookup;
  /** The damage model hits resolve through (with `shieldGuard()` registered for blocks). */
  readonly damage: DamageModel;
}

/**
 * Wires melee strikes into `world` (see the file header). Register the hit-volume, damage, timeline
 * and melee components first, and add the hit-volume system after the action timeline. Returns a
 * function that removes the subscriptions.
 */
export function installMeleeStrikes<TInput>(
  world: World<TInput>,
  options: MeleeStrikeOptions,
): () => void {
  const { moves, tracks, damage } = options;
  const w: World<never> = world;
  const offs = [
    world.events.on(ActionPhaseChanged, ({ entity, move: id, phase }) => {
      if (phase !== 'active' || !w.has(entity, HitboxComponent)) return;
      const move = moves.get(id);
      if (move?.hitbox == null) return;
      openHitbox(w, entity, hitboxFromMove(move, moveTrack(move, tracks), facingOf(w, entity)));
    }),
    world.events.on(ActionEnded, ({ entity, move, reason }) => {
      if (reason !== 'completed' && w.has(entity, HitboxComponent)) {
        closeHitboxes(w, entity, move);
      }
    }),
    world.events.on(HitboxHit, (hit) => {
      const move = moves.get(hit.hitbox);
      const template = move?.damage;
      if (move === undefined || template == null) return;
      const tags = move.unblockable ? [...template.tags, DAMAGE_TAGS.unblockable] : template.tags;
      const impulse = rotateToWorld(template.impulse, hit.direction);
      damage.apply(w, hit.target, hitPacket(hit, { ...template, impulse, tags }));
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
