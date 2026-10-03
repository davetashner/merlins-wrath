// Classes in the running game (mw-e19.5): the glue between class data (src/content/data/class/,
// mw-e19.4), the sim's apply-class rules (src/sim/progression/classes.ts) and the UI.
//
// - `createClassRules` builds the sim's ClassRules over content's classes and items and a world's
//   capability registry; `applyClass` applies one class to the player through them.
// - `classCards` turns the classes into the selection screen's cards, in PLAYER_CLASSES order.
// - `kitModel` derives the kit panel's view model (class, gold, carried items) from the sim.
// - `newGameRequest` reads the new-game choice from the page's query: `?newgame` opens the class
//   selection screen, `?class=<id>` applies that class straight away (tests, debugging); without
//   either the testbed boots as before, with no class (the e2e suites rely on that).
//
// Items have no display names yet (their nameKey has no string table), so `itemLabel` turns an id
// into a readable placeholder: "mana-draught" → "Mana draught".

import {
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

/** A class's starting kit as card lines: each item (count, equipped), then the gold. */
export function kitLines(def: ClassEntry): string[] {
  const lines = def.startingKit.items.map(({ item, count, equip }) => {
    const times = count > 1 ? ` ×${String(count)}` : '';
    return `${itemLabel(item.id)}${times}${equip ? ' (equipped)' : ''}`;
  });
  return [...lines, `${String(def.startingKit.gold)} gold`];
}

/** The selection screen's cards: one per class, in PLAYER_CLASSES order. */
export function classCards(content: Pick<GameContent, 'all'>): ClassCardModel[] {
  const byId = new Map(content.all('class').map((def) => [def.id, def]));
  return PLAYER_CLASSES.flatMap((id) => {
    const def = byId.get(id);
    return def === undefined
      ? []
      : [{ id, name: def.name, pitch: def.pitch, verbs: [...def.verbs], kit: kitLines(def) }];
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
  | { readonly kind: 'unknown-class'; readonly classId: string };

/** Reads `?newgame` and `?class=<id>` from a query string (`?class` wins). */
export function newGameRequest(search: string): NewGameRequest {
  const params = new URLSearchParams(search);
  const classId = params.get('class');
  if (classId !== null) {
    return isPlayerClass(classId) ? { kind: 'class', classId } : { kind: 'unknown-class', classId };
  }
  return params.has('newgame') ? { kind: 'select' } : { kind: 'none' };
}
