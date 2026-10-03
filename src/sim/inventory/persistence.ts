// Inventory persistence (mw-e17.8): what a save carries of every actor's pack (`inventory.pack`),
// equipment slots (`equipment.slots`) and quick slots (`item.quickSlots`), as one plain record per
// actor in entity order. The game's `inventory` save section (src/game/save/inventory.ts) wraps it
// with a schema, a version and migrations; this file holds the rules, so they stay deterministic.
//
// Loading a save written against older content can meet an item definition that no longer exists.
// `pruneUnknownItems` drops every instance of such a definition, every equipment slot and quick slot
// that refers to one, and reports each drop, so the rest of the inventory loads and the caller can log
// a warning. Statuses and weapon coatings are not here: they are timed effects, saved with the world.

import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';
import { QuickSlotsComponent, type QuickSlotsState } from '../items/consumables';
import {
  EQUIPMENT_SLOTS,
  EquipmentComponent,
  type EquipmentSlot,
  type EquipmentSlotsState,
  type SlotMap,
} from './equipment';
import { InventoryComponent, type InventoryState } from './inventory';

/** One actor's saved item state; a part is absent when the actor does not have that component. */
export interface ActorItemsRecord {
  readonly entity: EntityId;
  readonly inventory?: InventoryState;
  readonly equipment?: EquipmentSlotsState;
  readonly quickSlots?: QuickSlotsState;
}

/** Every actor's saved item state, in ascending entity order. */
export interface InventorySaveData {
  readonly actors: readonly ActorItemsRecord[];
}

/** The components inventory persistence saves (the world snapshot leaves them out). */
export const INVENTORY_SAVE_COMPONENTS: readonly ComponentType<unknown>[] = [
  InventoryComponent,
  EquipmentComponent,
  QuickSlotsComponent,
] as readonly ComponentType<unknown>[];

type Part = 'inventory' | 'equipment' | 'quickSlots';

const PARTS: readonly (readonly [Part, ComponentType<unknown>])[] = [
  ['inventory', InventoryComponent],
  ['equipment', EquipmentComponent],
  ['quickSlots', QuickSlotsComponent],
] as readonly (readonly [Part, ComponentType<unknown>])[];

/** Reads every actor's pack, equipment and quick slots out of `world`. */
export function captureInventories(world: World<never>): InventorySaveData {
  const byEntity = new Map<EntityId, Partial<Record<Part, unknown>>>();
  for (const [part, type] of PARTS) {
    if (!world.isRegistered(type)) continue;
    world.query(type).forEach((entity, value) => {
      const record = byEntity.get(entity) ?? {};
      record[part] = value;
      byEntity.set(entity, record);
    });
  }
  const actors = [...byEntity.entries()]
    .sort(([a], [b]) => a - b)
    .map(([entity, parts]) => ({ entity, ...parts }) as ActorItemsRecord);
  return { actors };
}

/**
 * Writes saved item state into `world`, registering a component type the world lacks. Call on a
 * world whose actors exist and hold none of these components (as a save load leaves it).
 */
export function applyInventories(world: World<never>, data: InventorySaveData): void {
  for (const record of data.actors) {
    for (const [part, type] of PARTS) {
      const value = record[part];
      if (value === undefined) continue;
      if (!world.isRegistered(type)) world.register(type);
      world.add(record.entity, type, value);
    }
  }
}

/** An item reference a load dropped because its definition no longer exists. */
export interface DroppedItem {
  readonly entity: EntityId;
  readonly defId: string;
  /** The pack instance, an equipment slot's instance, or a quick slot's stack (null when depleted). */
  readonly instanceId: number | null;
  /** Where it was: `pack`, an equipment slot, or `quick-slot-<n>` (1-based). */
  readonly where: 'pack' | EquipmentSlot | `quick-slot-${number}`;
}

/** Saved data with unknown items removed, and what was removed. */
export interface PruneResult {
  readonly data: InventorySaveData;
  readonly dropped: readonly DroppedItem[];
}

/**
 * Removes every reference to an item definition `known` rejects: pack instances, equipment slots
 * (a two-handed item leaves both hands) and quick slots. Everything else is kept as it was, and data
 * with nothing to drop is returned unchanged.
 */
export function pruneUnknownItems(
  data: InventorySaveData,
  known: (defId: string) => boolean,
): PruneResult {
  const dropped: DroppedItem[] = [];
  const unknownRef = (ref: { readonly defId: string } | null): boolean =>
    ref !== null && !known(ref.defId);
  const actors = data.actors.map((record) => {
    const { entity, inventory, equipment, quickSlots } = record;
    let next = record;
    if (inventory?.items.some((item) => !known(item.defId)) === true) {
      const items = inventory.items.filter((item) => {
        if (known(item.defId)) return true;
        dropped.push({ entity, defId: item.defId, instanceId: item.instanceId, where: 'pack' });
        return false;
      });
      next = { ...next, inventory: { ...inventory, items } };
    }
    if (equipment !== undefined && EQUIPMENT_SLOTS.some((s) => unknownRef(equipment.slots[s]))) {
      const slots = Object.fromEntries(
        EQUIPMENT_SLOTS.map((slot) => {
          const ref = equipment.slots[slot];
          if (ref === null || known(ref.defId)) return [slot, ref];
          dropped.push({ entity, defId: ref.defId, instanceId: ref.instanceId, where: slot });
          return [slot, null];
        }),
      ) as SlotMap;
      next = { ...next, equipment: { ...equipment, slots } };
    }
    if (quickSlots?.slots.some(unknownRef) === true) {
      const slots = quickSlots.slots.map((slot, i) => {
        if (slot === null || known(slot.defId)) return slot;
        const where = `quick-slot-${String(i + 1)}` as `quick-slot-${number}`;
        dropped.push({ entity, defId: slot.defId, instanceId: slot.instanceId, where });
        return null;
      });
      next = { ...next, quickSlots: { ...quickSlots, slots } };
    }
    return next;
  });
  return dropped.length === 0 ? { data, dropped } : { data: { actors }, dropped };
}
