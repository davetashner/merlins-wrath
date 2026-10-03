// Inventory persistence (mw-e17.8): capturing and applying every actor's pack, equipment and quick
// slots, and pruning items whose definition no longer exists. The save round trip itself (AC-1…AC-3)
// is tested with the game's inventory section in src/game/save/inventory.test.ts.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { QuickSlotsComponent, type QuickSlotsState } from '../items/consumables';
import { EquipmentComponent, emptySlots, type EquipmentSlotsState } from './equipment';
import { InventoryComponent, type InventoryState } from './inventory';
import {
  applyInventories,
  captureInventories,
  INVENTORY_SAVE_COMPONENTS,
  pruneUnknownItems,
  type InventorySaveData,
} from './persistence';

const arrows = { instanceId: 4, defId: 'arrow', count: 20, flags: {} };

const pack: InventoryState = {
  gold: 40,
  nextInstanceId: 5,
  items: [
    { instanceId: 1, defId: 'staff', count: 1, flags: {} },
    { instanceId: 2, defId: 'gone-draught', count: 3, flags: { stolen: true, ownerId: 'miller' } },
    arrows,
  ],
};

const worn: EquipmentSlotsState = {
  classId: 'knight',
  slots: {
    ...emptySlots(),
    'main-hand': { instanceId: 1, defId: 'staff' },
    'off-hand': { instanceId: 1, defId: 'staff' },
    ammo: { instanceId: 4, defId: 'arrow' },
  },
};

const quick: QuickSlotsState = {
  slots: [
    { defId: 'gone-draught', instanceId: 2 },
    null,
    { defId: 'gone-draught', instanceId: null },
    { defId: 'arrow', instanceId: 4 },
  ],
  busyUntil: 12,
};

const world = (): World<never> => new World<never>({ seed: 1, hz: 60 });

describe('captureInventories / applyInventories', () => {
  it('reads nothing from a world without the item components', () => {
    expect(captureInventories(world())).toEqual({ actors: [] });
  });

  it('captures each actor once, in entity order, with only the parts it has', () => {
    const w = world();
    for (const type of INVENTORY_SAVE_COMPONENTS) w.register(type);
    const [a, b, c] = [w.spawn(), w.spawn(), w.spawn()];
    // Added out of order, and the middle actor has no item components at all.
    w.add(c, QuickSlotsComponent, quick);
    w.add(a, EquipmentComponent, worn);
    w.add(a, InventoryComponent, pack);
    expect(b).toBeLessThan(c);
    expect(captureInventories(w)).toEqual({
      actors: [
        { entity: a, inventory: pack, equipment: worn },
        { entity: c, quickSlots: quick },
      ],
    });
  });

  it('applies saved parts, registering a component the world lacks', () => {
    const source = world();
    const [a, b] = [source.spawn(), source.spawn()];
    const data: InventorySaveData = {
      actors: [
        { entity: a, inventory: pack, equipment: worn, quickSlots: quick },
        { entity: b, inventory: { gold: 0, nextInstanceId: 1, items: [] } },
      ],
    };
    const target = world();
    target.spawn();
    target.spawn();
    target.register(InventoryComponent);
    applyInventories(target, data);
    expect(target.get(a, QuickSlotsComponent)).toEqual(quick);
    expect(target.get(b, EquipmentComponent)).toBeUndefined();
    expect(captureInventories(target)).toEqual(data);
  });
});

describe('pruneUnknownItems', () => {
  const known = (defId: string): boolean => defId !== 'gone-draught' && defId !== 'staff';

  it('returns the same data when every item is known', () => {
    const data: InventorySaveData = {
      actors: [{ entity: 1, inventory: pack, equipment: worn, quickSlots: quick }, { entity: 2 }],
    };
    const result = pruneUnknownItems(data, () => true);
    expect(result.data).toBe(data);
    expect(result.dropped).toEqual([]);
  });

  it('drops unknown instances, the slots that hold them, and quick slots on them', () => {
    const data: InventorySaveData = {
      actors: [{ entity: 7, inventory: pack, equipment: worn, quickSlots: quick }, { entity: 8 }],
    };
    const { data: pruned, dropped } = pruneUnknownItems(data, known);
    expect(pruned.actors).toEqual([
      {
        entity: 7,
        inventory: { gold: 40, nextInstanceId: 5, items: [arrows] },
        equipment: {
          classId: 'knight',
          slots: { ...emptySlots(), ammo: { instanceId: 4, defId: 'arrow' } },
        },
        quickSlots: { slots: [null, null, null, { defId: 'arrow', instanceId: 4 }], busyUntil: 12 },
      },
      { entity: 8 },
    ]);
    expect(dropped).toEqual([
      { entity: 7, defId: 'staff', instanceId: 1, where: 'pack' },
      { entity: 7, defId: 'gone-draught', instanceId: 2, where: 'pack' },
      { entity: 7, defId: 'staff', instanceId: 1, where: 'main-hand' },
      { entity: 7, defId: 'staff', instanceId: 1, where: 'off-hand' },
      { entity: 7, defId: 'gone-draught', instanceId: 2, where: 'quick-slot-1' },
      { entity: 7, defId: 'gone-draught', instanceId: null, where: 'quick-slot-3' },
    ]);
    // The input is not modified.
    expect(data.actors[0]?.inventory).toBe(pack);
  });

  it('leaves parts with nothing unknown untouched', () => {
    const clean: InventorySaveData = {
      actors: [
        {
          entity: 3,
          inventory: { gold: 1, nextInstanceId: 2, items: [arrows] },
          equipment: worn,
          quickSlots: { slots: [null, null, null, null], busyUntil: 0 },
        },
      ],
    };
    const { data, dropped } = pruneUnknownItems(clean, (defId) => defId !== 'staff');
    expect(data.actors[0]?.inventory).toBe(clean.actors[0]?.inventory);
    expect(data.actors[0]?.quickSlots).toBe(clean.actors[0]?.quickSlots);
    expect(dropped.map((item) => item.where)).toEqual(['main-hand', 'off-hand']);
  });
});
