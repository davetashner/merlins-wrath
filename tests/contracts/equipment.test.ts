// Contract between layers (mw-e17.4): items and classes are written and checked as content
// (src/content/types/item.ts, class.ts) and worn through the sim's equipment rules
// (src/sim/inventory/equipment.ts). Content may import the sim only as types, so this check lives
// outside src/: every shipped equippable item fits a sim slot, the armor slots agree, and the
// shipped kits wear as ADR-0003 says.

import { describe, expect, it } from 'vitest';
import * as content from '@content/index';
import {
  addEquipment,
  addInventory,
  EquipmentRules,
  InventoryRules,
  World,
  type EquipmentState,
} from '@sim/index';

const game = content.loadGameContent();
const items = game.all('item');
const rules = new EquipmentRules(items, game.all('class'));

/** A fresh actor of `classId` wearing its starting kit; its derived equipment state. */
function wearKit(classId: content.ClassEntry['id']): EquipmentState {
  const world = new World({ seed: 1 });
  const actor = world.spawn();
  addInventory(world, actor);
  addEquipment(world, actor, classId);
  const inventory = new InventoryRules(items);
  for (const kit of game.get('class', classId).startingKit.items) {
    const added = inventory.add(world, actor, kit.item.id, kit.count);
    expect(added.ok, kit.item.id).toBe(true);
    if (kit.equip && added.ok) {
      expect(rules.equip(world, actor, added.instanceIds[0] ?? 0).ok, kit.item.id).toBe(true);
    }
  }
  return rules.state(world, actor);
}

describe('equipment contract (mw-e17.4)', () => {
  it('every shipped item with an equip block, and all ammo, fits a sim slot', () => {
    for (const item of items) {
      const equippable = 'equip' in item ? item.equip !== undefined : item.category === 'ammo';
      expect(rules.slotsFor(item.id).length > 0, item.id).toBe(equippable);
    }
  });

  it('every loaded equip block carries a non-proficiency penalty', () => {
    for (const item of items) {
      if ('equip' in item && item.equip !== undefined) {
        expect(item.equip.nonProficient, item.id).toBeDefined();
      }
    }
  });

  it('the starting kits wear as ADR-0003 says, without proficiency penalties', () => {
    // Knight: mail (8 kg) and a wooden shield (3 kg) are 37% of 30 kg.
    expect(wearKit('knight')).toMatchObject({ armorKg: 11, loadClass: 'medium', penalties: [] });
    expect(wearKit('knight').noiseModifier).toBe(1.3);
    for (const classId of ['archer', 'thief', 'sorcerer'] as const) {
      expect(wearKit(classId), classId).toMatchObject({ loadClass: 'light', penalties: [] });
    }
  });
});
