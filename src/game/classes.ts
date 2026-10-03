// Classes in the running game (mw-e19.5): the glue between class data (src/content/data/class/,
// mw-e19.4), the sim's apply-class rules (src/sim/progression/classes.ts) and the UI.
//
// - `createClassRules` builds the sim's ClassRules over content's classes and items and a world's
//   capability registry; `applyClass` applies one class to the player through them.
// - `playableClasses` reads which classes this build lets the player confirm: the game configuration's
//   `playableClasses` (src/content/data/game/game.json, mw-e01.15; m1 ships the Knight only), or
//   every class when a debug build's page asks for `?allclasses` (tests, debugging).
// - `classCards` turns the classes into the selection screen's cards, in PLAYER_CLASSES order, locking
//   the ones that are not playable.
// - `kitModel` derives the kit panel's view model (class, gold, carried items) from the sim.
// - `newGameRequest` reads the new-game choice from the page's query: `?newgame` opens the class
//   selection screen, `?class=<id>` applies that class straight away (tests, debugging) if it is
//   playable; without either the testbed boots as before, with no class (the e2e suites rely on that).
//
// Items have no display names yet (their nameKey has no string table), so `itemLabel` turns an id
// into a readable placeholder: "mana-draught" → "Mana draught".

import {
  GAME_CONFIG_ID,
  PLAYER_CLASSES,
  type ClassEntry,
  type GameContent,
  type PlayerClass,
} from '@content/index';
import {
  ClassRules,
  classOf,
  EquipmentRules,
  equipmentOf,
  inventoryOf,
  InventoryRules,
  type CapabilityRegistry,
  type ClassApplied,
  type EntityId,
  type World,
} from '@sim/index';
import type { ClassCardModel, KitModel } from '@ui/index';

/** A readable placeholder name for item `id` until items have localised names. */
export function itemLabel(id: string): string {
  const words = id.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Apply-class rules over every content class and item, granting through `capabilities`. */
export function createClassRules(
  content: Pick<GameContent, 'all'>,
  capabilities: CapabilityRegistry,
): ClassRules {
  const items = content.all('item');
  const classes = content.all('class');
  return new ClassRules(classes, {
    capabilities,
    inventory: new InventoryRules(items),
    equipment: new EquipmentRules(items, classes),
  });
}

/** Whether `id` names a playable class. */
export function isPlayerClass(id: string): id is PlayerClass {
  return (PLAYER_CLASSES as readonly string[]).includes(id);
}

/** Applies class `classId` to `actor` with `rules` (see ClassRules.apply for what it throws). */
export function applyClass(
  world: World,
  actor: EntityId,
  classId: PlayerClass,
  rules: ClassRules,
): ClassApplied {
  return rules.apply(world, actor, classId);
}

/** The query flag that unlocks every class in a debug build (mw-e01.15). */
export const ALL_CLASSES_PARAM = 'allclasses';

/**
 * The classes this build lets the player confirm: the game configuration's `playableClasses`, or every
 * class when `debug` (a build with the debug console) and the query string has `?allclasses`.
 */
export function playableClasses(
  content: Pick<GameContent, 'get'>,
  search: string,
  debug: boolean,
): ReadonlySet<PlayerClass> {
  if (debug && new URLSearchParams(search).has(ALL_CLASSES_PARAM)) return new Set(PLAYER_CLASSES);
  const listed = content.get('game', GAME_CONFIG_ID).playableClasses.map(({ id }) => id);
  return new Set(listed.filter(isPlayerClass));
}

/** A class's starting kit as card lines: each item (count, equipped), then the gold. */
export function kitLines(def: ClassEntry): string[] {
  const lines = def.startingKit.items.map(({ item, count, equip }) => {
    const times = count > 1 ? ` ×${String(count)}` : '';
    return `${itemLabel(item.id)}${times}${equip ? ' (equipped)' : ''}`;
  });
  return [...lines, `${String(def.startingKit.gold)} gold`];
}

/** The selection screen's cards: one per class, in PLAYER_CLASSES order, locked unless `playable`. */
export function classCards(
  content: Pick<GameContent, 'all'>,
  playable: ReadonlySet<string>,
): ClassCardModel[] {
  const byId = new Map(content.all('class').map((def) => [def.id, def]));
  return PLAYER_CLASSES.flatMap((id) => {
    const def = byId.get(id);
    if (def === undefined) return [];
    const card = {
      id,
      name: def.name,
      pitch: def.pitch,
      verbs: [...def.verbs],
      kit: kitLines(def),
    };
    return [playable.has(id) ? card : { ...card, locked: true }];
  });
}

/** The kit panel's view model: null until `actor` has a class. */
export function kitModel(
  world: World,
  actor: EntityId,
  content: Pick<GameContent, 'get'>,
): KitModel | null {
  const classId = classOf(world, actor);
  if (classId === undefined) return null;
  const inventory = inventoryOf(world, actor);
  const slots = Object.values(equipmentOf(world, actor)?.slots ?? {});
  const equipped = new Set(slots.flatMap((ref) => (ref === null ? [] : [ref.instanceId])));
  return {
    className: content.get('class', classId).name,
    gold: inventory?.gold ?? 0,
    items: (inventory?.items ?? []).map(({ instanceId, defId, count }) => ({
      label: itemLabel(defId),
      count,
      equipped: equipped.has(instanceId),
    })),
  };
}

/** What the page's query asks of a new game. */
export type NewGameRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'select' }
  | { readonly kind: 'class'; readonly classId: PlayerClass }
  | { readonly kind: 'locked-class'; readonly classId: PlayerClass }
  | { readonly kind: 'unknown-class'; readonly classId: string };

/**
 * Reads `?newgame` and `?class=<id>` from a query string (`?class` wins). A class outside `playable`
 * is refused as `locked-class`: the build cannot support that run.
 */
export function newGameRequest(search: string, playable: ReadonlySet<string>): NewGameRequest {
  const params = new URLSearchParams(search);
  const classId = params.get('class');
  if (classId !== null) {
    if (!isPlayerClass(classId)) return { kind: 'unknown-class', classId };
    return playable.has(classId) ? { kind: 'class', classId } : { kind: 'locked-class', classId };
  }
  return params.has('newgame') ? { kind: 'select' } : { kind: 'none' };
}
