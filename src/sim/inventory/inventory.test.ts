import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import {
  addInventory,
  DEFAULT_GOLD_MAX,
  goldCapped,
  goldChanged,
  INVENTORY_UNIT_GUARD,
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  itemAdded,
  itemFlagChanged,
  itemRemoved,
  type InventoryItemDef,
} from './inventory';

const def = (
  id: string,
  category: InventoryItemDef['category'],
  extra: Partial<Omit<InventoryItemDef, 'flags'>> & {
    unique?: boolean;
    questItem?: boolean;
  } = {},
): InventoryItemDef => {
  const { unique = false, questItem = category === 'quest', ...rest } = extra;
  return { id, category, stackable: false, flags: { unique, questItem }, ...rest };
};

const ITEMS: readonly InventoryItemDef[] = [
  def('apple', 'consumable', { stackable: true, maxStack: 5 }),
  def('arrow', 'ammo', { stackable: true, maxStack: 50 }),
  def('sword', 'weapon'),
  def('tower-key', 'key'),
  def('cellar-key', 'key'),
  def('primer', 'book'),
  def('bell-tongue', 'quest', { unique: true }),
  def('charm', 'artifact', { unique: true, grants: [{ capability: 'spell.mage-hand' }] }),
  def('hook', 'tool', { grants: [{ capability: 'verb.climb.rough' }] }),
  def('seal', 'misc', { questItem: true }),
  def('gold', 'currency', { stackable: true, maxStack: 9999 }),
  def('loose', 'misc', { stackable: true }),
];

type Logged = [string, unknown];

const EMPTY = { gold: 0, nextInstanceId: 1, items: [] };

/** A world with one actor holding an empty inventory, the rules, and every event they emit. */
function setup(options?: ConstructorParameters<typeof InventoryRules>[1]) {
  const world = new World({ seed: 1 });
  const actor = world.spawn();
  addInventory(world, actor);
  const rules = new InventoryRules(ITEMS, options);
  const events: Logged[] = [];
  world.events.on(itemAdded, (e) => events.push(['added', e]));
  world.events.on(itemRemoved, (e) => events.push(['removed', e]));
  world.events.on(itemFlagChanged, (e) => events.push(['flag', e]));
  world.events.on(goldChanged, (e) => events.push(['gold', e]));
  world.events.on(goldCapped, (e) => events.push(['capped', e]));
  const flush = () => {
    world.events.flush();
    return events.splice(0);
  };
  const stacks = () => (inventoryOf(world, actor)?.items ?? []).map((i) => [i.defId, i.count]);
  return { world, actor, rules, flush, stacks };
}

describe('inventory stacks (mw-e17.3)', () => {
  it('AC-1: 3 then 4 of a maxStack-5 item make stacks of 5 and 2, with two item.added events', () => {
    const { world, actor, rules, flush, stacks } = setup();
    expect(rules.add(world, actor, 'apple', 3)).toEqual({ ok: true, instanceIds: [1] });
    expect(rules.add(world, actor, 'apple', 4)).toEqual({ ok: true, instanceIds: [1, 2] });
    expect(stacks()).toEqual([
      ['apple', 5],
      ['apple', 2],
    ]);
    const events = flush();
    expect(events.map(([kind]) => kind)).toEqual(['added', 'added']);
    expect(events.map(([, e]) => e)).toEqual([
      { tick: 0, actor, defId: 'apple', count: 3, flags: {}, instanceIds: [1] },
      { tick: 0, actor, defId: 'apple', count: 4, flags: {}, instanceIds: [1, 2] },
    ]);
  });

  it('AC-1: a large add opens as many full stacks as it needs; one item.added', () => {
    const { world, actor, rules, flush, stacks } = setup();
    rules.add(world, actor, 'apple', 12);
    expect(stacks()).toEqual([
      ['apple', 5],
      ['apple', 5],
      ['apple', 2],
    ]);
    expect(flush()).toHaveLength(1);
  });

  it('AC-2: a stolen apple never merges with clean apples and its stack carries the owner', () => {
    const { world, actor, rules, flush } = setup();
    rules.add(world, actor, 'apple', 2);
    const result = rules.add(world, actor, 'apple', 1, { stolen: true, ownerId: 'miller' });
    expect(result).toEqual({ ok: true, instanceIds: [2] });
    expect(inventoryOf(world, actor)?.items).toEqual([
      { instanceId: 1, defId: 'apple', count: 2, flags: {} },
      { instanceId: 2, defId: 'apple', count: 1, flags: { stolen: true, ownerId: 'miller' } },
    ]);
    // A further clean apple joins the clean stack, a further stolen one the stolen stack.
    rules.add(world, actor, 'apple', 1);
    rules.add(world, actor, 'apple', 1, { ownerId: 'miller', stolen: true });
    expect(rules.query(world, actor, { stolen: true }).map((i) => i.count)).toEqual([2]);
    expect(rules.query(world, actor, { stolen: false }).map((i) => i.count)).toEqual([3]);
    expect(flush().at(1)?.[1]).toMatchObject({ flags: { stolen: true, ownerId: 'miller' } });
  });

  it('AC-2: units differing only in owner or binding keep separate stacks; false flags are dropped', () => {
    const { world, actor, rules, stacks } = setup();
    rules.add(world, actor, 'apple', 1, { stolen: true, ownerId: 'miller' });
    rules.add(world, actor, 'apple', 1, { stolen: true, ownerId: 'abbot' });
    rules.add(world, actor, 'apple', 1, { bound: true });
    rules.add(world, actor, 'apple', 1, { stolen: false, bound: false });
    expect(stacks()).toHaveLength(4);
    expect(inventoryOf(world, actor)?.items.at(2)?.flags).toEqual({ bound: true });
    expect(inventoryOf(world, actor)?.items.at(3)?.flags).toEqual({});
  });

  it('gives an item that does not stack, or a unique one, one instance per unit', () => {
    const { world, actor, rules, stacks } = setup();
    expect(rules.add(world, actor, 'sword', 2)).toEqual({ ok: true, instanceIds: [1, 2] });
    expect(rules.add(world, actor, 'loose', 2)).toEqual({ ok: true, instanceIds: [3, 4] });
    expect(rules.add(world, actor, 'charm', 1)).toEqual({ ok: true, instanceIds: [5] });
    expect(stacks()).toEqual([
      ['sword', 1],
      ['sword', 1],
      ['loose', 1],
      ['loose', 1],
      ['charm', 1],
    ]);
  });

  it('refuses a second unique item and currency, changing nothing', () => {
    const { world, actor, rules, flush } = setup();
    rules.add(world, actor, 'charm', 1);
    flush();
    const before = inventoryOf(world, actor);
    expect(rules.add(world, actor, 'charm', 1)).toEqual({ ok: false, reason: 'unique-held' });
    expect(rules.add(world, actor, 'bell-tongue', 2)).toEqual({ ok: false, reason: 'unique-held' });
    expect(rules.add(world, actor, 'gold', 5)).toEqual({ ok: false, reason: 'currency' });
    expect(inventoryOf(world, actor)).toBe(before);
    expect(flush()).toEqual([]);
  });

  it('refuses an add past the 9,999-unit guard with stack-limit, changing nothing (ADR-0003)', () => {
    expect(INVENTORY_UNIT_GUARD).toBe(9999);
    const { world, actor, rules, flush } = setup();
    expect(rules.add(world, actor, 'arrow', 9990)).toMatchObject({ ok: true });
    const before = inventoryOf(world, actor);
    flush();
    expect(rules.add(world, actor, 'arrow', 10)).toEqual({ ok: false, reason: 'stack-limit' });
    expect(inventoryOf(world, actor)).toBe(before);
    expect(flush()).toEqual([]);
    expect(rules.add(world, actor, 'arrow', 9)).toMatchObject({ ok: true });
    expect(rules.count(world, actor, { defId: 'arrow' })).toBe(9999);
    // Stolen units count towards the same definition's guard.
    expect(rules.add(world, actor, 'arrow', 1, { stolen: true })).toMatchObject({
      reason: 'stack-limit',
    });
  });

  it('has no capacity: any number of definitions and units fit (ADR-0003)', () => {
    const { world, actor, rules } = setup();
    for (const id of ['apple', 'arrow', 'sword', 'primer', 'hook', 'tower-key']) {
      expect(rules.add(world, actor, id, 1).ok).toBe(true);
    }
    expect(rules.add(world, actor, 'arrow', 5000).ok).toBe(true);
  });
});

describe('inventory removal (mw-e17.3)', () => {
  it('AC-3: a non-forced remove of a quest item is refused with quest-item; nothing changes', () => {
    const { world, actor, rules, flush } = setup();
    rules.add(world, actor, 'bell-tongue', 1);
    rules.add(world, actor, 'seal', 1);
    flush();
    const before = inventoryOf(world, actor);
    expect(rules.remove(world, actor, { defId: 'bell-tongue', count: 1 })).toEqual({
      ok: false,
      reason: 'quest-item',
    });
    expect(rules.remove(world, actor, { instanceId: 2, count: 1, force: false })).toEqual({
      ok: false,
      reason: 'quest-item',
    });
    expect(inventoryOf(world, actor)).toBe(before);
    expect(flush()).toEqual([]);
  });

  it('AC-3: an effect with force: true removes a quest item', () => {
    const { world, actor, rules, flush, stacks } = setup();
    rules.add(world, actor, 'bell-tongue', 1);
    flush();
    expect(rules.remove(world, actor, { defId: 'bell-tongue', count: 1, force: true })).toEqual({
      ok: true,
      instanceIds: [1],
    });
    expect(stacks()).toEqual([]);
    expect(flush()).toEqual([
      [
        'removed',
        { tick: 0, actor, defId: 'bell-tongue', count: 1, instanceIds: [1], forced: true },
      ],
    ]);
  });

  it('AC-6: removing more units than held fails atomically, with no partial removal', () => {
    const { world, actor, rules, flush } = setup();
    rules.add(world, actor, 'apple', 7);
    rules.add(world, actor, 'apple', 1, { stolen: true });
    flush();
    const before = inventoryOf(world, actor);
    expect(rules.remove(world, actor, { defId: 'apple', count: 9 })).toEqual({
      ok: false,
      reason: 'not-enough',
    });
    expect(rules.remove(world, actor, { defId: 'apple', count: 8, stolen: false })).toEqual({
      ok: false,
      reason: 'not-enough',
    });
    expect(rules.remove(world, actor, { instanceId: 2, count: 3 })).toEqual({
      ok: false,
      reason: 'not-enough',
    });
    expect(rules.remove(world, actor, { defId: 'sword', count: 1 })).toEqual({
      ok: false,
      reason: 'not-enough',
    });
    expect(inventoryOf(world, actor)).toBe(before);
    expect(rules.count(world, actor, { defId: 'apple' })).toBe(8);
    expect(flush()).toEqual([]);
  });

  it('AC-6: a remove that fits takes from the newest matching stacks first', () => {
    const { world, actor, rules, flush, stacks } = setup();
    rules.add(world, actor, 'apple', 12); // 5, 5, 2
    rules.add(world, actor, 'apple', 1, { stolen: true }); // instance 4
    flush();
    expect(rules.remove(world, actor, { defId: 'apple', count: 3, stolen: false })).toEqual({
      ok: true,
      instanceIds: [3, 2],
    });
    expect(stacks()).toEqual([
      ['apple', 5],
      ['apple', 4],
      ['apple', 1],
    ]);
    expect(rules.remove(world, actor, { defId: 'apple', count: 2 })).toEqual({
      ok: true,
      instanceIds: [4, 2],
    });
    expect(stacks()).toEqual([
      ['apple', 5],
      ['apple', 3],
    ]);
    expect(flush().map(([, e]) => e)).toEqual([
      { tick: 0, actor, defId: 'apple', count: 3, instanceIds: [3, 2], forced: false },
      { tick: 0, actor, defId: 'apple', count: 2, instanceIds: [4, 2], forced: false },
    ]);
    // Later adds top up the partial stack before opening a new one.
    expect(rules.add(world, actor, 'apple', 3)).toEqual({ ok: true, instanceIds: [2, 5] });
  });

  it('removes units of one instance, and reports an unknown instance', () => {
    const { world, actor, rules, stacks } = setup();
    rules.add(world, actor, 'apple', 7); // 5, 2
    expect(rules.remove(world, actor, { instanceId: 1, count: 5 })).toEqual({
      ok: true,
      instanceIds: [1],
    });
    expect(stacks()).toEqual([['apple', 2]]);
    expect(rules.remove(world, actor, { instanceId: 1, count: 1 })).toEqual({
      ok: false,
      reason: 'no-instance',
    });
  });
});

describe('inventory views and queries (mw-e17.3)', () => {
  /** An inventory picked up in a mixed order. */
  function stocked() {
    const s = setup();
    const { world, actor, rules } = s;
    rules.add(world, actor, 'tower-key', 1); // 1
    rules.add(world, actor, 'apple', 2); // 2
    rules.add(world, actor, 'primer', 1); // 3
    rules.add(world, actor, 'cellar-key', 1); // 4
    rules.add(world, actor, 'charm', 1); // 5
    rules.add(world, actor, 'bell-tongue', 1); // 6
    rules.add(world, actor, 'hook', 1); // 7
    rules.add(world, actor, 'seal', 1); // 8
    rules.add(world, actor, 'tower-key', 1, { stolen: true, ownerId: 'warden' }); // 9
    return s;
  }
  const ids = (items: readonly { instanceId: number }[]) => items.map((i) => i.instanceId);

  it('AC-4: querying category key returns only keys, in stable acquisition order', () => {
    const { world, actor, rules } = stocked();
    const keys = rules.query(world, actor, { category: 'key' });
    expect(keys.map((i) => i.defId)).toEqual(['tower-key', 'cellar-key', 'tower-key']);
    expect(ids(keys)).toEqual([1, 4, 9]);
    // Removing and re-adding other items does not reorder the keys.
    rules.remove(world, actor, { defId: 'apple', count: 2 });
    rules.add(world, actor, 'apple', 1);
    expect(ids(rules.query(world, actor, { category: 'key' }))).toEqual([1, 4, 9]);
    expect(ids(rules.query(world, actor, { view: 'keyring' }))).toEqual([1, 4, 9]);
  });

  it('views the bookshelf, quest objects, artifacts and consumables over the one list', () => {
    const { world, actor, rules } = stocked();
    expect(ids(rules.query(world, actor, { view: 'bookshelf' }))).toEqual([3]);
    expect(ids(rules.query(world, actor, { view: 'quest' }))).toEqual([6, 8]);
    expect(ids(rules.query(world, actor, { view: 'artifacts' }))).toEqual([5]);
    expect(ids(rules.query(world, actor, { view: 'consumables' }))).toEqual([2]);
    expect(ids(rules.query(world, actor))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('queries by capability granted, definition and stolen flag, every criterion together', () => {
    const { world, actor, rules } = stocked();
    expect(ids(rules.query(world, actor, { capability: 'verb.climb.rough' }))).toEqual([7]);
    expect(ids(rules.query(world, actor, { capability: 'spell.mage-hand' }))).toEqual([5]);
    expect(ids(rules.query(world, actor, { capability: 'spell.nothing' }))).toEqual([]);
    expect(ids(rules.query(world, actor, { defId: 'tower-key', stolen: true }))).toEqual([9]);
    expect(ids(rules.query(world, actor, { view: 'keyring', stolen: false }))).toEqual([1, 4]);
    expect(rules.count(world, actor, { category: 'key' })).toBe(3);
    expect(rules.count(world, actor)).toBe(10);
  });

  it('returns nothing for an actor without an inventory', () => {
    const { world, rules } = setup();
    const other = world.spawn();
    expect(rules.query(world, other)).toEqual([]);
    expect(rules.count(world, other)).toBe(0);
    expect(inventoryOf(new World({ seed: 1 }), other)).toBeUndefined();
  });
});

describe('inventory flags (mw-e17.3)', () => {
  it('changes an instance’s flags with item.flagChanged; no merge, no event for equal flags', () => {
    const { world, actor, rules, flush } = setup();
    rules.add(world, actor, 'apple', 2);
    rules.add(world, actor, 'apple', 1, { stolen: true, ownerId: 'miller' });
    flush();
    expect(rules.setFlags(world, actor, 2, {})).toBe(true);
    expect(inventoryOf(world, actor)?.items.map((i) => [i.instanceId, i.count, i.flags])).toEqual([
      [1, 2, {}],
      [2, 1, {}],
    ]);
    expect(flush()).toEqual([
      [
        'flag',
        {
          tick: 0,
          actor,
          instanceId: 2,
          defId: 'apple',
          before: { stolen: true, ownerId: 'miller' },
          after: {},
        },
      ],
    ]);
    expect(rules.setFlags(world, actor, 2, { stolen: false })).toBe(false);
    expect(rules.setFlags(world, actor, 99, { bound: true })).toBe(false);
    expect(flush()).toEqual([]);
  });
});

describe('gold (mw-e17.3)', () => {
  it('AC-5: gold at 2^31-10 plus 100 clamps at the configured maximum and emits gold.capped', () => {
    expect(DEFAULT_GOLD_MAX).toBe(2 ** 31 - 1);
    const { world, actor, rules, flush } = setup();
    world.set(actor, InventoryComponent, { gold: 2 ** 31 - 10, nextInstanceId: 1, items: [] });
    expect(rules.addGold(world, actor, 100)).toBe(DEFAULT_GOLD_MAX);
    expect(inventoryOf(world, actor)?.gold).toBe(DEFAULT_GOLD_MAX);
    expect(flush()).toEqual([
      ['gold', { tick: 0, actor, before: 2 ** 31 - 10, after: DEFAULT_GOLD_MAX }],
      ['capped', { tick: 0, actor, max: DEFAULT_GOLD_MAX, lost: 91 }],
    ]);
    // Already at the cap: nothing changes, but the loss is still reported.
    expect(rules.addGold(world, actor, 5)).toBe(DEFAULT_GOLD_MAX);
    expect(flush()).toEqual([['capped', { tick: 0, actor, max: DEFAULT_GOLD_MAX, lost: 5 }]]);
  });

  it('AC-5: a configured maximum clamps the same way', () => {
    const { world, actor, rules, flush } = setup({ goldMax: 1000 });
    expect(rules.addGold(world, actor, 400)).toBe(400);
    expect(rules.addGold(world, actor, 700)).toBe(1000);
    expect(flush().map(([kind]) => kind)).toEqual(['gold', 'gold', 'capped']);
  });

  it('spends gold only when enough is held', () => {
    const { world, actor, rules, flush } = setup();
    rules.addGold(world, actor, 50);
    flush();
    expect(rules.spendGold(world, actor, 60)).toBe(false);
    expect(flush()).toEqual([]);
    expect(rules.spendGold(world, actor, 50)).toBe(true);
    expect(inventoryOf(world, actor)?.gold).toBe(0);
    expect(flush()).toEqual([['gold', { tick: 0, actor, before: 50, after: 0 }]]);
  });

  it('starts an inventory with the gold it is given', () => {
    const world = new World({ seed: 1 });
    const actor = world.spawn();
    addInventory(world, actor, 25);
    expect(inventoryOf(world, actor)).toEqual({ gold: 25, nextInstanceId: 1, items: [] });
  });
});

describe('inventory state (mw-e17.3)', () => {
  it('is plain data that snapshots, restores and hashes carry', () => {
    const { world, actor, rules } = setup();
    rules.add(world, actor, 'apple', 7);
    rules.add(world, actor, 'apple', 1, { stolen: true, ownerId: 'miller' });
    rules.add(world, actor, 'bell-tongue', 1);
    rules.addGold(world, actor, 120);
    world.step();
    const hash = hashWorld(world);
    const snapshot = world.snapshot();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);

    const restored = new World({ seed: 9 }).register(InventoryComponent);
    restored.restore(snapshot);
    expect(hashWorld(restored)).toBe(hash);
    expect(inventoryOf(restored, actor)).toEqual(inventoryOf(world, actor));
    // The restored instance counter keeps ids unique.
    expect(rules.add(restored, actor, 'sword', 1)).toEqual({ ok: true, instanceIds: [5] });
  });

  it('applies several operations in one tick, and the same operations hash the same', () => {
    const run = () => {
      const world = new World({ seed: 3 });
      const actor = world.spawn();
      addInventory(world, actor);
      const rules = new InventoryRules(ITEMS);
      world.addSystem({
        name: 'loot',
        run: ({ world: w }) => {
          rules.add(w, actor, 'apple', 4);
          rules.add(w, actor, 'apple', 4);
          rules.remove(w, actor, { defId: 'apple', count: 1 });
          rules.addGold(w, actor, 3);
        },
      });
      world.step();
      expect(rules.count(world, actor, { defId: 'apple' })).toBe(7);
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });

  it('a stackable definition without maxStack stacks one per instance', () => {
    const { world, actor, rules, stacks } = setup();
    rules.add(world, actor, 'loose', 1);
    expect(stacks()).toEqual([['loose', 1]]);
  });
});

describe('inventory misuse (mw-e17.3)', () => {
  it('throws for unknown items, bad counts and actors without an inventory', () => {
    const { world, actor, rules } = setup();
    const bare = world.spawn();
    expect(() => rules.add(world, actor, 'nothing', 1)).toThrow(/"nothing" is not defined/);
    expect(() => rules.add(world, actor, 'apple', 0)).toThrow(RangeError);
    expect(() => rules.add(world, actor, 'apple', 1.5)).toThrow(/positive integer/);
    expect(() => rules.add(world, bare, 'apple', 1)).toThrow(/no inventory/);
    expect(() => rules.remove(world, actor, { defId: 'apple', count: -1 })).toThrow(RangeError);
    expect(() => rules.remove(world, actor, { defId: 'nothing', count: 1 })).toThrow(RangeError);
    expect(() => rules.setFlags(world, bare, 1, {})).toThrow(/no inventory/);
    expect(() => rules.addGold(world, actor, 0)).toThrow(RangeError);
    expect(() => rules.spendGold(world, actor, Number.NaN)).toThrow(RangeError);
    expect(() => rules.addGold(new World({ seed: 1 }), 1, 1)).toThrow(/no inventory/);
  });

  it('rejects duplicate definitions and bad limits', () => {
    expect(() => new InventoryRules([...ITEMS, ...ITEMS.slice(0, 1)])).toThrow(/defined twice/);
    expect(() => new InventoryRules(ITEMS, { goldMax: 0 })).toThrow(/goldMax/);
    expect(() => new InventoryRules(ITEMS, { unitGuard: 2.5 })).toThrow(/unitGuard/);
    expect(new InventoryRules(ITEMS, { unitGuard: 3 }).unitGuard).toBe(3);
  });

  it('addInventory registers the component once', () => {
    const world = new World({ seed: 1 });
    const [a, b] = [world.spawn(), world.spawn()];
    addInventory(world, a);
    addInventory(world, b);
    expect(world.isRegistered(InventoryComponent)).toBe(true);
    expect([inventoryOf(world, a), inventoryOf(world, b)]).toEqual([EMPTY, EMPTY]);
  });
});
