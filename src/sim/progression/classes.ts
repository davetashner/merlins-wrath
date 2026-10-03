// Applying a class at new game (mw-e19.5, ADR-0004): the one step that turns a fresh player into a
// knight, archer, sorcerer or thief. `ClassRules.apply` reads the class's data (mw-e19.4) and, in
// order:
//   1. records the class on the actor (`player.class`, saved with the world like any component) and
//      writes the `player.class` fact when the world declares it, so conditions can gate on it;
//   2. grants every starting capability through the capability registry with the permanent `class`
//      source;
//   3. adds the kit's gold and items to the inventory, in file order, and equips every item marked
//      `equip` (equipment is worn as the class, so its proficiencies and armor capacity apply);
//   4. sets the supporting stats' start values (`progression.stats`; the stats system is mw-e19.6).
//
// A class is chosen once: applying a class to an actor that already has one throws
// ClassAlreadySetError (`class-already-set`) and changes nothing, since classes never stack and
// there is no respec (owner decision, mw-e19.1). Missing capability, inventory and equipment
// components are added first; adding a component is structural, so apply between steps (the
// new-game flow does, while its screen pauses the sim).
//
// An unknown class or kit item is refused before anything changes. Undeclared starting capabilities
// and kits the inventory refuses cannot load (checkClasses, mw-e19.4), so they are not rolled back.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import {
  addEquipment,
  EquipmentComponent,
  equipmentOf,
  type EquipmentRules,
} from '../inventory/equipment';
import { addInventory, inventoryOf, type InventoryRules } from '../inventory/inventory';
import { addCapabilities, CapabilitiesComponent, type CapabilityRegistry } from './capabilities';

/** The fact conditions read the player's class from (src/content/data/fact/player.json). */
export const PLAYER_CLASS_FACT = 'player.class';

/** The capability source a class's starting capabilities are granted with (ADR-0004). */
export const CLASS_SOURCE = 'class';

/** An actor's chosen class (`player.class`; a snapshot and save key, never renamed). */
export interface PlayerClassState {
  readonly classId: string;
}

export const PlayerClassComponent = defineComponent<PlayerClassState>('player.class');

/** The three supporting stats (ADR-0004). */
export interface SupportingStats {
  readonly health: number;
  readonly stamina: number;
  readonly mana: number;
}

/** An actor's supporting stats (`progression.stats`; a snapshot and save key, never renamed). */
export const StatsComponent = defineComponent<SupportingStats>('progression.stats');

/** What applying a class reads from its data (a loaded `ClassEntry`, mw-e19.4, is one). */
export interface ClassApplyDef {
  readonly id: string;
  readonly startingCapabilities: readonly string[];
  readonly startingKit: {
    readonly gold: number;
    readonly items: readonly {
      readonly item: { readonly id: string };
      readonly count: number;
      readonly equip: boolean;
    }[];
  };
  readonly stats: SupportingStats;
}

/** Thrown when a class is applied to an actor that already has one (no stacking of classes). */
export class ClassAlreadySetError extends Error {
  override readonly name = 'ClassAlreadySetError';
  readonly code = 'class-already-set';

  constructor(
    readonly actor: EntityId,
    readonly current: string,
    readonly requested: string,
  ) {
    super(
      `class-already-set: entity ${String(actor)} is already a ${current}, so it cannot become a ${requested}`,
    );
  }
}

/** `actor`'s class, or undefined before one is applied. */
export function classOf(world: World, actor: EntityId): string | undefined {
  return world.isRegistered(PlayerClassComponent)
    ? world.get(actor, PlayerClassComponent)?.classId
    : undefined;
}

/** `actor`'s supporting stats, or undefined before a class sets them. */
export function statsOf(world: World, actor: EntityId): SupportingStats | undefined {
  return world.isRegistered(StatsComponent) ? world.get(actor, StatsComponent) : undefined;
}

/** What applying a class did. */
export interface ClassApplied {
  readonly classId: string;
  /** Capabilities the actor gained (its first source), in data order. */
  readonly gained: readonly string[];
  /** Inventory instance ids of the kit, in data order. */
  readonly items: readonly number[];
  /** Inventory instance ids the kit equipped, in data order. */
  readonly equipped: readonly number[];
}

/** The classes and the rules applying one goes through. */
export class ClassRules {
  readonly #classes: ReadonlyMap<string, ClassApplyDef>;
  readonly #capabilities: CapabilityRegistry;
  readonly #inventory: InventoryRules;
  readonly #equipment: EquipmentRules;

  /** `classes`: every class definition (the content registry's). */
  constructor(
    classes: Iterable<ClassApplyDef>,
    rules: {
      readonly capabilities: CapabilityRegistry;
      readonly inventory: InventoryRules;
      readonly equipment: EquipmentRules;
    },
  ) {
    this.#classes = new Map([...classes].map((def) => [def.id, def]));
    this.#capabilities = rules.capabilities;
    this.#inventory = rules.inventory;
    this.#equipment = rules.equipment;
  }

  /** The class ids, in definition order. */
  get ids(): readonly string[] {
    return [...this.#classes.keys()];
  }

  /** The class `classId`. @throws RangeError for an id it does not know. */
  def(classId: string): ClassApplyDef {
    const def = this.#classes.get(classId);
    if (def === undefined) throw new RangeError(`class "${classId}" is not defined`);
    return def;
  }

  /**
   * Applies class `classId` to `actor` (see the file header). Call between steps.
   * @throws ClassAlreadySetError when the actor already has a class.
   * @throws RangeError for an unknown class, an unknown kit item, or a kit the inventory refuses.
   * @throws UnknownCapabilityError for an undeclared starting capability (the registry's `throw`
   *   policy).
   */
  apply(world: World, actor: EntityId, classId: string): ClassApplied {
    const current = classOf(world, actor);
    if (current !== undefined) throw new ClassAlreadySetError(actor, current, classId);
    const def = this.def(classId);
    for (const { item } of def.startingKit.items) this.#inventory.def(item.id);

    if (!world.isRegistered(PlayerClassComponent)) world.register(PlayerClassComponent);
    world.add(actor, PlayerClassComponent, { classId });
    if (world.facts.isDeclared(PLAYER_CLASS_FACT)) world.facts.set(PLAYER_CLASS_FACT, classId);

    if (!world.isRegistered(CapabilitiesComponent) || !world.has(actor, CapabilitiesComponent)) {
      addCapabilities(world, actor);
    }
    const gained = def.startingCapabilities.filter((capability) =>
      this.#capabilities.grant(world, actor, capability, CLASS_SOURCE),
    );

    if (inventoryOf(world, actor) === undefined) addInventory(world, actor);
    const equipment = equipmentOf(world, actor);
    if (equipment === undefined) addEquipment(world, actor, classId);
    else world.set(actor, EquipmentComponent, { ...equipment, classId });
    if (def.startingKit.gold > 0) this.#inventory.addGold(world, actor, def.startingKit.gold);
    const items: number[] = [];
    const equipped: number[] = [];
    for (const { item, count, equip } of def.startingKit.items) {
      const added = this.#inventory.add(world, actor, item.id, count);
      if (!added.ok) {
        throw new RangeError(
          `class "${classId}" kit item "${item.id}" was refused by the inventory: ${added.reason}`,
        );
      }
      items.push(...added.instanceIds);
      if (equip) {
        // An equipped kit item is one unit (checkClasses), so its add made exactly one instance.
        for (const instanceId of added.instanceIds.slice(0, 1)) {
          this.#equipment.equip(world, actor, instanceId);
          equipped.push(instanceId);
        }
      }
    }

    if (!world.isRegistered(StatsComponent)) world.register(StatsComponent);
    world.add(actor, StatsComponent, { ...def.stats });
    return { classId, gained, items, equipped };
  }
}
