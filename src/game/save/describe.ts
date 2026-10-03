// What a save says about itself (mw-e30.14): the slot description every save the game makes carries
// (manual, autosave, death screen, debug). The character is the player's class by its display name,
// read from the sim's `player.class` (set by class selection, mw-e19.5), so a thief's save says
// Thief. Before a class is chosen (or in a scene with no player) the class is `none` and the name
// empty, and the slot lists without one.

import type { GameContent } from '@content/index';
import { classOf, type EntityId, type World } from '@sim/index';
import type { SlotDescription } from './slots/index';

/** The class id a save made before any class was chosen records (the `player.class` default). */
export const NO_CLASS = 'none';

/** The slot description of a save of `world` made now in area `areaId`. */
export function describeSave(
  world: World<never>,
  player: EntityId | undefined,
  content: Pick<GameContent, 'get' | 'has'>,
  areaId: string,
): SlotDescription {
  const classId = player === undefined ? undefined : classOf(world, player);
  if (classId === undefined) return { characterName: '', classId: NO_CLASS, areaId };
  const characterName = content.has('class', classId)
    ? content.get('class', classId).name
    : classId;
  return { characterName, classId, areaId };
}
