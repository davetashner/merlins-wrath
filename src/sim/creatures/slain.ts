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
import { DAY_FACT } from '../rest/day-clock';
import { CreatureComponent } from './components';

/** The fact name a slain placed creature sets: `entity:<level>/<point>.slain`. */
export const SLAIN_FACT = 'slain';

/** The slain fact of the creature placed at spawn point `point` of `level`. */
export function slainFact(level: string, point: string): string {
  return entityFactKey(level, point, SLAIN_FACT);
}

/** The fact name that records the world day a placed creature was killed (0: never). */
export const KILLED_DAY_FACT = 'killed-day';

/** The killed-day fact of the creature placed at spawn point `point` of `level`. */
export function killedDayFact(level: string, point: string): string {
  return entityFactKey(level, point, KILLED_DAY_FACT);
}

/**
 * Sets the slain fact of every placed creature of `level` that dies in `world` (see the file
 * header), and, for the spawns in `repopulating` that opt in, the day it died. Returns a function that uninstalls it.
 */
export function installSlainFacts(
  world: World<never>,
  level: string,
  repopulating: readonly { readonly id: string; readonly repopulate?: unknown }[] = [],
): () => void {
  const returns = new Set(repopulating.filter((s) => s.repopulate !== undefined).map((s) => s.id));
  return world.events.on(Died, ({ target }) => {
    if (!world.isRegistered(CreatureComponent)) return;
    const point = world.get(target, CreatureComponent)?.origin.point;
    if (point === undefined) return;
    world.facts.set(slainFact(level, point), true);
    // The world day of the kill, only for spawns that repopulate (mw-ju8.29): other creatures
    // leave exactly the facts they always did.
    if (!returns.has(point)) return;
    world.facts.set(killedDayFact(level, point), Number(world.facts.get(DAY_FACT) ?? 1));
  });
}
