// mw-e17.3: the inventory over the real fixture items (one per category, loaded and validated like
// game content), and an inventory surviving a real save and load with its state hash.
import { FIXTURE_ITEM_IDS, loadItemFixtureContent } from '@content/test-fixtures';
import { ITEM_STACK_GUARD } from '@content/types/item';
import { SaveRegistry } from '@game/save/format';
import {
  addInventory,
  hashWorld,
  INVENTORY_UNIT_GUARD,
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const items = loadItemFixtureContent().all('item');
const ids = FIXTURE_ITEM_IDS;

function setup() {
  const world = new World({ seed: 7 });
  const actor = world.spawn();
  addInventory(world, actor);
  return { world, actor, rules: new InventoryRules(items) };
}

describe('inventory over the fixture items (mw-e17.3)', () => {
  it('uses the item schema’s 9,999-unit guard (ADR-0003)', () => {
    expect(INVENTORY_UNIT_GUARD).toBe(ITEM_STACK_GUARD);
  });

  it('AC-1: arrows chunk at their maxStack; swords and shields are one per instance', () => {
    const { world, actor, rules } = setup();
    rules.add(world, actor, ids.ammo, 30);
    rules.add(world, actor, ids.ammo, 40);
    rules.add(world, actor, ids.weapon, 2);
    expect(inventoryOf(world, actor)?.items.map((i) => [i.defId, i.count])).toEqual([
      [ids.ammo, 50],
      [ids.ammo, 20],
      [ids.weapon, 1],
      [ids.weapon, 1],
    ]);
  });

  it('AC-3: the bell tongue is a quest item by default and only a forced effect removes it', () => {
    const { world, actor, rules } = setup();
    rules.add(world, actor, ids.quest, 1);
    expect(rules.remove(world, actor, { defId: ids.quest, count: 1 })).toEqual({
      ok: false,
      reason: 'quest-item',
    });
    expect(rules.remove(world, actor, { defId: ids.quest, count: 1, force: true }).ok).toBe(true);
  });

  it('AC-4: every category lands in its view, and the gold fixture is the counter, not an item', () => {
    const { world, actor, rules } = setup();
    for (const [category, id] of Object.entries(ids)) {
      if (category !== 'currency') expect(rules.add(world, actor, id, 1).ok).toBe(true);
    }
    expect(rules.add(world, actor, ids.currency, 10)).toEqual({ ok: false, reason: 'currency' });
    const view = (v: Parameters<typeof rules.query>[2]) =>
      rules.query(world, actor, v).map((i) => i.defId);
    expect(view({ category: 'key' })).toEqual([ids.key]);
    expect(view({ view: 'keyring' })).toEqual([ids.key]);
    expect(view({ view: 'bookshelf' })).toEqual([ids.book]);
    expect(view({ view: 'quest' })).toEqual([ids.quest]);
    expect(view({ view: 'artifacts' })).toEqual([ids.artifact]);
    expect(view({ view: 'consumables' })).toEqual([ids.consumable]);
    expect(view({ capability: 'verb.climb.rough' })).toEqual([ids.tool]);
  });

  it('a save restores the inventory, its flags and gold, and the state hash', () => {
    const { world, actor, rules } = setup();
    rules.add(world, actor, ids.consumable, 13);
    rules.add(world, actor, ids.consumable, 2, { stolen: true, ownerId: 'miller' });
    rules.add(world, actor, ids.quest, 1);
    rules.add(world, actor, ids.key, 1);
    rules.addGold(world, actor, 250);
    world.step();
    const registry = new SaveRegistry();
    const bytes = registry.write(world, {
      build: { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' },
      wallClockSavedAt: 1_790_000_000_000,
    });

    const loaded = new World({ seed: 1 }).register(InventoryComponent);
    expect(registry.read(loaded, bytes)).toMatchObject({ ok: true });
    expect(inventoryOf(loaded, actor)).toEqual(inventoryOf(world, actor));
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    expect(rules.count(loaded, actor, { defId: ids.consumable, stolen: true })).toBe(2);
    expect(rules.remove(loaded, actor, { defId: ids.quest, count: 1 })).toMatchObject({
      reason: 'quest-item',
    });
  });
});
