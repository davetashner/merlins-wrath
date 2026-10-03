// The inventory save section (mw-e17.8 AC-1…AC-3): packs, equipment and quick slots survive a save
// and load exactly; a removed item definition costs only that item; a v1 save loads at the current
// version through the migration runner.
import { loadGameContent } from '@content/index';
import { prepareConsumables, prepareWorldItems } from '@game/items/index';
import {
  addEquipment,
  addInventory,
  addQuickSlots,
  captureInventories,
  CoatingComponent,
  emptySlots,
  EquipmentComponent,
  EquipmentRules,
  hashWorld,
  InventoryComponent,
  InventoryRules,
  QUICK_SLOT_COUNT,
  QuickSlotsComponent,
  Rng,
  StatusesComponent,
  World,
  type EntityId,
  type InventorySaveData,
  type ItemInstanceFlags,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { encodeSave, migrateSection, validateSection, WORLD_SECTION_VERSION } from './format';
import {
  droppedItemMessage,
  INVENTORY_MIGRATIONS,
  INVENTORY_SECTION_ID,
  INVENTORY_SECTION_VERSION,
  inventorySaveSection,
} from './inventory';
import { createGameSaveRegistry } from './sections';

const content = loadGameContent();
const items = content.all('item');
const itemIds = items.map((item) => item.id);
const classIds = content.all('class').map((def) => def.id);
const inventory = new InventoryRules(items);
const equipment = new EquipmentRules(items, content.all('class'));
const consumables = prepareConsumables(content, prepareWorldItems(content));
const knownItem = (id: string): boolean => content.has('item', id);

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };
const OWNERS = ['miller', 'chapel', 'guard-captain'] as const;

/** A world as the game builds it before any actor has items: the timed item effects registered. */
function emptyWorld(seed: number): World<never> {
  const world = new World<never>({ seed, hz: 60 });
  world.register(StatusesComponent);
  world.register(CoatingComponent);
  return world;
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.int(0, list.length - 1)] as T;
}

function randomFlags(rng: Rng): ItemInstanceFlags {
  return {
    ...(rng.chance(0.35) && { stolen: true }),
    ...(rng.chance(0.25) && { ownerId: pick(rng, OWNERS) }),
    ...(rng.chance(0.1) && { bound: true }),
  };
}

/** Random instance id held by `actor`, or a stale one when the pack is empty. */
function someInstance(world: World<never>, rng: Rng, actor: EntityId): number {
  const held = inventory.query(world, actor);
  return held.length === 0 ? 1 : pick(rng, held).instanceId;
}

/**
 * One to three actors, each put through a random run of real inventory operations: adds with random
 * flags and counts (stacks split at maxStack), removes, flag changes, equips and quick-slot binds.
 */
function randomInventories(seed: number): World<never> {
  const rng = Rng.create(seed).stream('inventory-fuzz');
  const world = emptyWorld(seed);
  const actors = rng.int(1, 3);
  for (let a = 0; a < actors; a++) {
    if (rng.chance(0.3)) world.spawn(); // gaps in entity ids
    const actor = world.spawn();
    addInventory(world, actor, rng.int(0, 5000));
    addEquipment(world, actor, pick(rng, classIds));
    addQuickSlots(world, actor);
    const ops = rng.int(5, 40);
    for (let op = 0; op < ops; op++) {
      const roll = rng.float();
      if (roll < 0.45) {
        inventory.add(world, actor, pick(rng, itemIds), rng.int(1, 25), randomFlags(rng));
      } else if (roll < 0.55) {
        const defId = pick(rng, itemIds);
        const held = inventory.count(world, actor, { defId });
        if (held > 0) inventory.remove(world, actor, { defId, count: rng.int(1, held) });
      } else if (roll < 0.65) {
        inventory.setFlags(world, actor, someInstance(world, rng, actor), randomFlags(rng));
      } else if (roll < 0.85) {
        equipment.equip(world, actor, someInstance(world, rng, actor));
      } else {
        consumables.assign(
          world,
          actor,
          rng.int(0, QUICK_SLOT_COUNT - 1),
          someInstance(world, rng, actor),
        );
      }
    }
    const slots = world.get(actor, QuickSlotsComponent);
    if (slots !== undefined) {
      world.set(actor, QuickSlotsComponent, { ...slots, busyUntil: rng.int(0, 600) });
    }
  }
  return world;
}

describe('inventory save section', () => {
  it('AC-1: 100 seeded random inventories with stolen flags, stacks and equipped items round-trip deep-equal', () => {
    const registry = createGameSaveRegistry({ knownItem });
    const seen = { stolen: 0, owned: 0, bound: 0, splitStacks: 0, equipped: 0, twoHanded: 0 };
    const seen2 = { quickSlots: 0, busy: 0 };
    for (let seed = 1; seed <= 100; seed++) {
      const world = randomInventories(seed);
      const before = captureInventories(world);
      for (const { inventory: pack, equipment: worn, quickSlots } of before.actors) {
        const packItems = pack?.items ?? [];
        seen.stolen += packItems.filter((item) => item.flags.stolen === true).length;
        seen.owned += packItems.filter((item) => item.flags.ownerId !== undefined).length;
        seen.bound += packItems.filter((item) => item.flags.bound === true).length;
        const defs = packItems.map((item) => item.defId);
        seen.splitStacks += defs.length - new Set(defs).size;
        const refs = Object.values(worn?.slots ?? {}).filter((ref) => ref !== null);
        seen.equipped += refs.length;
        seen.twoHanded += Number(
          worn !== undefined &&
            worn.slots['main-hand'] !== null &&
            worn.slots['main-hand'].instanceId === worn.slots['off-hand']?.instanceId,
        );
        seen2.quickSlots += (quickSlots?.slots ?? []).filter((slot) => slot !== null).length;
        seen2.busy += Number((quickSlots?.busyUntil ?? 0) > 0);
      }

      const bytes = registry.write(world, saveOptions);
      const loaded = emptyWorld(seed + 1000);
      const result = registry.read(loaded, bytes);
      expect(result.ok, `seed ${String(seed)}`).toBe(true);
      expect(captureInventories(loaded), `seed ${String(seed)}`).toEqual(before);
      expect(hashWorld(loaded), `seed ${String(seed)}`).toBe(hashWorld(world));
    }
    // The generator really exercised what the AC names.
    for (const [what, n] of Object.entries({ ...seen, ...seen2 })) {
      expect(n, what).toBeGreaterThan(0);
    }
  });

  it('AC-2: a save holding a removed item definition drops that instance, warns, and loads the rest', () => {
    const world = emptyWorld(5);
    const actor = world.spawn();
    addInventory(world, actor, 75);
    addEquipment(world, actor, 'knight');
    addQuickSlots(world, actor);
    inventory.add(world, actor, 'arming-sword', 1);
    inventory.add(world, actor, 'healing-draught', 4, { stolen: true, ownerId: 'miller' });
    const pack = defined(world.get(actor, InventoryComponent));
    // A lantern from an older build's content, worn on the belt and bound to a quick slot.
    const lantern = { instanceId: pack.nextInstanceId, defId: 'retired-lantern', count: 1 };
    world.set(actor, InventoryComponent, {
      ...pack,
      nextInstanceId: pack.nextInstanceId + 1,
      items: [...pack.items, { ...lantern, flags: {} }],
    });
    equipment.equip(world, actor, 1);
    const worn = defined(world.get(actor, EquipmentComponent));
    const ref = { instanceId: lantern.instanceId, defId: lantern.defId };
    world.set(actor, EquipmentComponent, {
      ...worn,
      slots: { ...worn.slots, 'tool-belt-1': ref },
    });
    world.set(actor, QuickSlotsComponent, {
      slots: [{ defId: 'healing-draught', instanceId: 2 }, ref, null, null],
      busyUntil: 0,
    });
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    // What survives: the pack as it was, its instance counter past the lantern (ids are never reused).
    const kept = { ...pack, nextInstanceId: lantern.instanceId + 1 };

    const warn = vi.fn<(message: string) => void>();
    const loaded = emptyWorld(6);
    const result = createGameSaveRegistry({ knownItem, warn }).read(loaded, bytes);

    expect(result.ok).toBe(true);
    expect(loaded.get(actor, InventoryComponent)).toEqual(kept);
    expect(loaded.get(actor, EquipmentComponent)).toEqual({
      classId: 'knight',
      slots: { ...emptySlots(), 'main-hand': { instanceId: 1, defId: 'arming-sword' } },
    });
    expect(loaded.get(actor, QuickSlotsComponent)?.slots).toEqual([
      { defId: 'healing-draught', instanceId: 2 },
      null,
      null,
      null,
    ]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      `save: dropped item "retired-lantern" (instance 3) from entity ${String(actor)}'s pack: the item is no longer defined`,
      `save: dropped item "retired-lantern" (instance 3) from entity ${String(actor)}'s tool-belt-1: the item is no longer defined`,
      `save: dropped item "retired-lantern" (instance 3) from entity ${String(actor)}'s quick-slot-2: the item is no longer defined`,
    ]);

    // Without a logger the drop still happens; without content ids every item is kept.
    const quiet = emptyWorld(7);
    expect(createGameSaveRegistry({ knownItem }).read(quiet, bytes).ok).toBe(true);
    expect(quiet.get(actor, InventoryComponent)).toEqual(kept);
    const keepAll = emptyWorld(8);
    expect(createGameSaveRegistry().read(keepAll, bytes).ok).toBe(true);
    expect(keepAll.get(actor, InventoryComponent)?.items).toHaveLength(3);
  });

  it('AC-3: a v1 inventory save passes through the migration runner at the current version and loads', () => {
    const section = inventorySaveSection({ knownItem });
    const v1: InventorySaveData = {
      actors: [
        {
          entity: 1,
          inventory: {
            gold: 12,
            nextInstanceId: 3,
            items: [
              { instanceId: 1, defId: 'hunting-knife', count: 1, flags: { bound: true } },
              { instanceId: 2, defId: 'standard-arrow', count: 40, flags: { stolen: true } },
            ],
          },
          equipment: {
            classId: 'thief',
            slots: {
              ...emptySlots(),
              'main-hand': { instanceId: 1, defId: 'hunting-knife' },
              ammo: { instanceId: 2, defId: 'standard-arrow' },
            },
          },
          quickSlots: {
            slots: [null, { defId: 'healing-draught', instanceId: null }],
            busyUntil: 3,
          },
        },
      ],
    };
    const migrated = migrateSection(section, { version: 1, data: v1 });
    expect(migrated).toEqual({ ok: true, data: v1 });
    expect(validateSection(section, migrated.ok ? migrated.data : undefined)).toEqual({
      ok: true,
      data: v1,
    });

    // The same data in a save file, beside a world section, loads into a fresh world.
    const source = emptyWorld(9);
    source.spawn();
    const bytes = encodeSave({
      ...build,
      createdAtTick: 0,
      wallClockSavedAt: saveOptions.wallClockSavedAt,
      metadata: {},
      sections: {
        world: { version: WORLD_SECTION_VERSION, data: source.snapshot() },
        [INVENTORY_SECTION_ID]: { version: 1, data: v1 },
      },
    });
    const world = emptyWorld(10);
    const result = createGameSaveRegistry({ knownItem }).read(world, bytes);
    expect(result.ok && result.warnings).toEqual([]);
    expect(captureInventories(world)).toEqual(v1);
  });

  it('is version 1 with an empty migration chain, and claims the item components', () => {
    const section = inventorySaveSection();
    expect(section.version).toBe(INVENTORY_SECTION_VERSION);
    expect(INVENTORY_SECTION_VERSION).toBe(1);
    expect(INVENTORY_MIGRATIONS).toEqual({});
    expect(section.components?.map(({ name }) => name)).toEqual([
      'inventory.pack',
      'equipment.slots',
      'item.quickSlots',
    ]);
  });

  it('names a depleted quick slot without an instance in its warning', () => {
    expect(
      droppedItemMessage({
        entity: 4,
        defId: 'old-tonic',
        instanceId: null,
        where: 'quick-slot-1',
      }),
    ).toBe(
      `save: dropped item "old-tonic" from entity 4's quick-slot-1: the item is no longer defined`,
    );
  });

  it('rejects malformed data', () => {
    const section = inventorySaveSection();
    const bad = { actors: [{ entity: 1, inventory: { gold: -1, nextInstanceId: 1, items: [] } }] };
    expect(validateSection(section, bad).ok).toBe(false);
  });
});
