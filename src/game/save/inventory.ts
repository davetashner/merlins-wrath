// The `inventory` save section (mw-e17.8): every actor's pack, equipment slots and quick slots
// (src/sim/inventory/persistence.ts), versioned and migrated on their own so item changes never touch
// the world section. A load drops whatever refers to an item definition this build no longer has,
// logs one warning per drop and loads the rest: losing a removed item is better than losing the save.

import {
  applyInventories,
  captureInventories,
  EQUIPMENT_SLOTS,
  INVENTORY_SAVE_COMPONENTS,
  pruneUnknownItems,
  type DroppedItem,
  type EquipmentSlot,
  type InventorySaveData,
} from '@sim/index';
import { z } from 'zod';
import { defineSaveSection, type SaveSection, type SectionMigration } from './format';

/** Id of the inventory section (never renamed). */
export const INVENTORY_SECTION_ID = 'inventory';

/** Data version of the inventory section. v1 (mw-e17.8): packs, equipment slots and quick slots. */
export const INVENTORY_SECTION_VERSION = 1;

/**
 * `INVENTORY_MIGRATIONS[n]` upgrades inventory data from v`n` to v`n + 1`. v1 is the first version,
 * so the chain is empty: a v1 save passes through the runner unchanged. The next shape change bumps
 * the version and adds `1: (data) => …` here.
 */
export const INVENTORY_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze({});

const count = z.int().positive();
const tick = z.int().nonnegative();
const defId = z.string().min(1);

const itemRef = z.strictObject({ instanceId: count, defId });

const inventorySchema = z.strictObject({
  gold: z.int().nonnegative(),
  nextInstanceId: count,
  items: z.array(
    z.strictObject({
      instanceId: count,
      defId,
      count,
      flags: z.strictObject({
        stolen: z.boolean().exactOptional(),
        ownerId: z.string().exactOptional(),
        bound: z.boolean().exactOptional(),
      }),
    }),
  ),
});

const equipmentSchema = z.strictObject({
  classId: z.string().min(1),
  slots: z.strictObject(
    Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, itemRef.nullable()])) as Record<
      EquipmentSlot,
      z.ZodNullable<typeof itemRef>
    >,
  ),
});

const quickSlotsSchema = z.strictObject({
  slots: z.array(z.strictObject({ defId, instanceId: count.nullable() }).nullable()),
  busyUntil: tick,
});

const inventoryDataSchema = z.strictObject({
  actors: z.array(
    z.strictObject({
      entity: count,
      inventory: inventorySchema.exactOptional(),
      equipment: equipmentSchema.exactOptional(),
      quickSlots: quickSlotsSchema.exactOptional(),
    }),
  ),
}) satisfies z.ZodType<InventorySaveData>;

export interface InventorySectionOptions {
  /**
   * Whether an item definition exists in this build (the content registry's item ids). When
   * omitted, every saved item is kept.
   */
  readonly knownItem?: (defId: string) => boolean;
  /** Receives one message per item a load dropped. */
  readonly warn?: (message: string) => void;
}

/** The warning a load logs for a dropped item. */
export function droppedItemMessage(item: DroppedItem): string {
  const instance = item.instanceId === null ? '' : ` (instance ${String(item.instanceId)})`;
  return `save: dropped item "${item.defId}"${instance} from entity ${String(item.entity)}'s ${item.where}: the item is no longer defined`;
}

/** The inventory save section; register it after the world section. */
export function inventorySaveSection(
  options: InventorySectionOptions = {},
): SaveSection<InventorySaveData> {
  const { knownItem, warn } = options;
  return defineSaveSection<InventorySaveData>({
    id: INVENTORY_SECTION_ID,
    version: INVENTORY_SECTION_VERSION,
    schema: inventoryDataSchema,
    components: INVENTORY_SAVE_COMPONENTS,
    migrations: INVENTORY_MIGRATIONS,
    serialize: (world) => captureInventories(world),
    deserialize: (world, saved) => {
      let data = saved;
      if (knownItem !== undefined) {
        const pruned = pruneUnknownItems(saved, knownItem);
        data = pruned.data;
        for (const item of pruned.dropped) warn?.(droppedItemMessage(item));
      }
      applyInventories(world, data);
    },
  });
}
