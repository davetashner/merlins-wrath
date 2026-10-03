// Slain facts (mw-e01.7): a creature a level placed (a scene spawn point) that dies sets the entity
// fact `entity:<level>/<spawn point>.slain` (declared once as the `entity:*.slain` template), so
// quests, dialogue, level variants and the slice's readouts can ask whether the skeleton by pillar B
// is dead without finding its entity. The creature itself stays dead through saves anyway (the world
// and its level deltas carry its health); the fact is what other systems read.
//
// Console and test spawns have no spawn point and set nothing. Died is emitted once per entity, so
// the fact is written once.

import { Died } from '../combat/damage/events';
import type { World } from '../core/world';
import { entityFactKey } from '../facts/store';
import { CreatureComponent } from './components';

/** The fact name a slain placed creature sets: `entity:<level>/<point>.slain`. */
export const SLAIN_FACT = 'slain';

/** The slain fact of the creature placed at spawn point `point` of `level`. */
export function slainFact(level: string, point: string): string {
  return entityFactKey(level, point, SLAIN_FACT);
}

/**
 * Sets the slain fact of every placed creature of `level` that dies in `world` (see the file
 * header). Returns a function that uninstalls it.
 */
export function installSlainFacts(world: World<never>, level: string): () => void {
  return world.events.on(Died, ({ target }) => {
    if (!world.isRegistered(CreatureComponent)) return;
    const point = world.get(target, CreatureComponent)?.origin.point;
    if (point !== undefined) world.facts.set(slainFact(level, point), true);
  });
}
