import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { World } from '../core/world';
import type { FactReader } from '../facts/conditions';
import type { FactValue } from '../facts/store';
import { Rng } from '../rng';
import {
  LOOT_MAX_DEPTH,
  LOOT_RNG_STREAM,
  lootDepthExceeded,
  LootReferenceError,
  LootTables,
  obtainedFactKey,
  simpleLootPredicate,
  type LootConditions,
  type LootDepthExceeded,
  type LootEntry,
  type LootItemDef,
  type LootTableDef,
} from './tables';

/** A fact reader over a plain record. */
const facts = (values: Readonly<Record<string, FactValue>> = {}): FactReader => ({
  get: (key) => values[key],
  entries: (prefix = '') => Object.entries(values).filter(([key]) => key.startsWith(prefix)),
});

const ITEMS: readonly LootItemDef[] = [
  { id: 'arrow' },
  { id: 'bread' },
  { id: 'coin' },
  { id: 'lockpicks' },
  { id: 'gem', flags: { unique: false } },
  { id: 'ring', flags: { unique: true } },
];

const ref = (id: string) => ({ id });

/** A table with defaults: no guaranteed items, no rolls, no entries, duplicates allowed. */
const table = (id: string, rest: Partial<LootTableDef> = {}): LootTableDef => ({
  id,
  guaranteed: [],
  rolls: { min: 0, max: 0 },
  entries: [],
  noDuplicates: false,
  ...rest,
});

const item = (id: string, weight: number, rest: Partial<LootEntry> = {}): LootEntry => ({
  item: ref(id),
  weight,
  count: { min: 1, max: 1 },
  ...rest,
});

const nested = (id: string, weight: number, rest: Partial<LootEntry> = {}): LootEntry => ({
  table: ref(id),
  weight,
  count: { min: 1, max: 1 },
  ...rest,
});

const once = { min: 1, max: 1 };

describe('loot tables (mw-e18.1)', () => {
  it('AC-1: a table with 2 guaranteed items and 0 rolls yields exactly those 2 items', () => {
    const tables = new LootTables(
      [
        table('chest', {
          guaranteed: [
            { item: ref('bread'), count: 2 },
            { item: ref('coin'), count: 15 },
          ],
          entries: [item('arrow', 1)],
        }),
      ],
      ITEMS,
    );
    for (let seed = 0; seed < 200; seed++) {
      expect(tables.roll('chest', Rng.create(seed), { facts: facts() })).toEqual({
        stacks: [
          { item: 'bread', count: 2 },
          { item: 'coin', count: 15 },
        ],
      });
    }
  });

  it('AC-2: the same table, seed and context give identical sequences over 10,000 rolls', () => {
    const defs = [
      table('hoard', {
        guaranteed: [{ item: ref('coin'), count: 3 }],
        rolls: { min: 0, max: 3 },
        entries: [
          item('arrow', 5, { count: { min: 1, max: 20 } }),
          item('lockpicks', 2, { conditions: { class: [ref('thief')] } }),
          item('ring', 1),
          nested('sundries', 3, { count: { min: 1, max: 2 } }),
        ],
      }),
      table('sundries', {
        rolls: once,
        noDuplicates: true,
        entries: [
          item('bread', 2),
          item('gem', 1, { conditions: { when: { fact: 'mine.open' } } }),
        ],
      }),
    ];
    const run = () => {
      const tables = new LootTables(defs, ITEMS);
      const rng = Rng.create(0xbe11);
      const context = { classId: 'thief', facts: facts({ 'mine.open': true }) };
      return Array.from({ length: 10_000 }, () => tables.roll('hoard', rng, context).stacks);
    };
    const first = run();
    expect(run()).toEqual(first);
    // The sequence really varies: several distinct results, including nested and conditional ones.
    const seen = new Set(first.flat().map((stack) => stack.item));
    expect([...seen].sort()).toEqual(['arrow', 'bread', 'coin', 'gem', 'lockpicks', 'ring']);
  });

  it('AC-3: weights 3:1 over 40,000 seeded rolls land within ±2% of 75%/25%', () => {
    const tables = new LootTables(
      [table('weighted', { rolls: once, entries: [item('arrow', 3), item('bread', 1)] })],
      ITEMS,
    );
    const rng = Rng.create(42);
    let arrows = 0;
    const total = 40_000;
    for (let i = 0; i < total; i++) {
      const [stack] = tables.roll('weighted', rng, { facts: facts() }).stacks;
      if (stack?.item === 'arrow') arrows++;
    }
    expect(Math.abs(arrows / total - 0.75)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((total - arrows) / total - 0.25)).toBeLessThanOrEqual(0.02);
  });

  describe('AC-4: unique items already obtained', () => {
    const defs = [
      table('relics', {
        rolls: once,
        entries: [item('ring', 2), item('arrow', 3), item('bread', 1)],
      }),
    ];

    it('AC-4: skips an obtained unique and shares its weight out among the rest (3:1)', () => {
      const tables = new LootTables(defs, ITEMS);
      const rng = Rng.create(7);
      const context = { facts: facts({ [obtainedFactKey('ring')]: true }) };
      const tally = new Map<string, number>();
      const total = 40_000;
      for (let i = 0; i < total; i++) {
        for (const { item: id } of tables.roll('relics', rng, context).stacks) {
          tally.set(id, (tally.get(id) ?? 0) + 1);
        }
      }
      expect(tally.has('ring')).toBe(false);
      expect(Math.abs((tally.get('arrow') ?? 0) / total - 0.75)).toBeLessThanOrEqual(0.02);
      expect(Math.abs((tally.get('bread') ?? 0) / total - 0.25)).toBeLessThanOrEqual(0.02);
    });

    it('AC-4: drops the unique while it is not obtained (read from the obtained fact)', () => {
      expect(obtainedFactKey('ring')).toBe('item.ring.obtained');
      const tables = new LootTables(defs, ITEMS);
      const rng = Rng.create(7);
      const unobtained = { facts: facts({ [obtainedFactKey('ring')]: false }) };
      const drops = Array.from({ length: 300 }, () => tables.roll('relics', rng, unobtained));
      expect(drops.some((roll) => roll.stacks[0]?.item === 'ring')).toBe(true);
    });

    it('AC-4: a context may say what is obtained instead of the fact store', () => {
      const tables = new LootTables(
        [table('one', { rolls: once, entries: [item('ring', 99), item('bread', 1)] })],
        ITEMS,
      );
      const context = { facts: facts(), isObtained: (id: string) => id === 'ring' };
      for (let seed = 0; seed < 50; seed++) {
        expect(tables.roll('one', Rng.create(seed), context).stacks).toEqual([
          { item: 'bread', count: 1 },
        ]);
      }
    });

    it('AC-4: skips a guaranteed unique already obtained, and yields nothing when only it is left', () => {
      const tables = new LootTables(
        [
          table('shrine', {
            guaranteed: [
              { item: ref('ring'), count: 1 },
              { item: ref('coin'), count: 1 },
            ],
            rolls: { min: 3, max: 3 },
            entries: [item('ring', 1)],
          }),
        ],
        ITEMS,
      );
      const obtained = { facts: facts({ [obtainedFactKey('ring')]: true }) };
      expect(tables.roll('shrine', Rng.create(1), obtained).stacks).toEqual([
        { item: 'coin', count: 1 },
      ]);
    });

    it('drops a unique at most once per roll, one unit at a time', () => {
      const tables = new LootTables(
        [
          table('vault', {
            guaranteed: [{ item: ref('ring'), count: 5 }],
            rolls: { min: 4, max: 4 },
            entries: [item('ring', 9, { count: { min: 3, max: 3 } }), nested('vault-inner', 1)],
          }),
          table('vault-inner', { rolls: once, entries: [item('ring', 1), item('coin', 1)] }),
        ],
        ITEMS,
      );
      for (let seed = 0; seed < 50; seed++) {
        const { stacks } = tables.roll('vault', Rng.create(seed), { facts: facts() });
        expect(stacks[0]).toEqual({ item: 'ring', count: 1 });
        expect(stacks.filter((stack) => stack.item === 'ring')).toHaveLength(1);
      }
    });
  });

  describe('AC-5: conditional entries', () => {
    const defs = [
      table('thief-cache', {
        rolls: { min: 2, max: 2 },
        entries: [
          item('lockpicks', 50, { conditions: { class: [ref('thief')] } }),
          item('arrow', 1),
        ],
      }),
    ];

    it('AC-5: an entry conditioned on class thief never drops for a knight', () => {
      const tables = new LootTables(defs, ITEMS);
      const rng = Rng.create(3);
      for (let i = 0; i < 5_000; i++) {
        const { stacks } = tables.roll('thief-cache', rng, { classId: 'knight', facts: facts() });
        expect(stacks).toEqual([{ item: 'arrow', count: 2 }]);
      }
    });

    it('AC-5: the same entry drops for a thief, and never with no class given', () => {
      const tables = new LootTables(defs, ITEMS);
      const thief = Array.from({ length: 50 }, (_, seed) =>
        tables.roll('thief-cache', Rng.create(seed), { classId: 'thief', facts: facts() }),
      );
      expect(thief.some((roll) => roll.stacks.some((s) => s.item === 'lockpicks'))).toBe(true);
      const nobody = tables.roll('thief-cache', Rng.create(0), { facts: facts() });
      expect(nobody.stacks).toEqual([{ item: 'arrow', count: 2 }]);
    });

    it('AC-5: fact conditions gate entries on world facts, and class and fact must both hold', () => {
      const when = { fact: 'cellar.open' };
      const pred = (conditions: LootConditions, classId: string, open: boolean) =>
        simpleLootPredicate(conditions, { classId, facts: facts({ 'cellar.open': open }) });
      expect(pred({ when }, 'knight', true)).toBe(true);
      expect(pred({ when }, 'knight', false)).toBe(false);
      // The compiled condition is reused for the same object.
      expect(pred({ when }, 'knight', true)).toBe(true);
      const both = { class: [ref('thief'), ref('archer')], when };
      expect(pred(both, 'archer', true)).toBe(true);
      expect(pred(both, 'archer', false)).toBe(false);
      expect(pred(both, 'knight', true)).toBe(false);
      expect(pred({}, 'knight', false)).toBe(true);
    });

    it('AC-5: a replacement predicate (the future condition DSL) plugs in unchanged', () => {
      const asked: LootConditions[] = [];
      const tables = new LootTables(defs, ITEMS, {
        predicate: (conditions) => {
          asked.push(conditions);
          return true;
        },
      });
      const roll = tables.roll('thief-cache', Rng.create(5), { classId: 'knight', facts: facts() });
      expect(roll.stacks.some((s) => s.item === 'lockpicks')).toBe(true);
      expect(asked[0]).toBe(defs[0]?.entries[0]?.conditions);
    });
  });

  describe('AC-6: nesting deeper than LOOT_MAX_DEPTH', () => {
    it('AC-6: a table that rolls itself stops at depth 4 and emits loot.depthExceeded', () => {
      expect(LOOT_MAX_DEPTH).toBe(4);
      const tables = new LootTables(
        [
          table('ouroboros', {
            guaranteed: [{ item: ref('coin'), count: 1 }],
            rolls: { min: 3, max: 3 },
            entries: [nested('ouroboros', 1, { count: { min: 2, max: 2 } })],
          }),
        ],
        ITEMS,
      );
      const bus = new EventBus();
      const seen: LootDepthExceeded[] = [];
      bus.on(lootDepthExceeded, (event) => seen.push(event));
      const roll = tables.roll(
        'ouroboros',
        Rng.create(9),
        { facts: facts() },
        { events: bus, tick: 12 },
      );
      bus.flush();
      const error = {
        tick: 12,
        table: 'ouroboros',
        chain: ['ouroboros', 'ouroboros', 'ouroboros', 'ouroboros', 'ouroboros'],
        maxDepth: 4,
      };
      // One coin per table rolled, depths 1–4, before the fifth level stopped the roll.
      expect(roll).toEqual({ stacks: [{ item: 'coin', count: 4 }], error });
      expect(seen).toEqual([error]);
    });

    it('AC-6: a chain through several tables reports every table, even with no event sink', () => {
      const chainOf = ['a', 'b', 'c', 'd', 'e'];
      const defs = chainOf.map((id, i) =>
        table(id, {
          rolls: once,
          entries: [nested(chainOf[i + 1] ?? 'a', 1)],
          guaranteed: [{ item: ref('bread'), count: 1 }],
        }),
      );
      const roll = new LootTables(defs, ITEMS).roll('a', Rng.create(1), { facts: facts() });
      expect(roll.error).toEqual({ tick: 0, table: 'a', chain: chainOf, maxDepth: 4 });
      expect(roll.stacks).toEqual([{ item: 'bread', count: 4 }]);
    });

    it('rolls a chain exactly 4 tables deep in full', () => {
      const defs = [
        table('d1', { rolls: once, entries: [nested('d2', 1)] }),
        table('d2', { rolls: once, entries: [nested('d3', 1)] }),
        table('d3', { rolls: once, entries: [nested('d4', 1)] }),
        table('d4', { rolls: once, entries: [item('gem', 1)] }),
      ];
      expect(new LootTables(defs, ITEMS).roll('d1', Rng.create(1), { facts: facts() })).toEqual({
        stacks: [{ item: 'gem', count: 1 }],
      });
    });
  });

  it('lets each entry win once per roll of a noDuplicates table, then stops rolling', () => {
    const tables = new LootTables(
      [
        table('distinct', {
          rolls: { min: 5, max: 5 },
          noDuplicates: true,
          entries: [item('arrow', 1), item('bread', 1), item('coin', 1, { weight: 0 })],
        }),
      ],
      ITEMS,
    );
    for (let seed = 0; seed < 50; seed++) {
      const { stacks } = tables.roll('distinct', Rng.create(seed), { facts: facts() });
      expect(stacks.map((s) => s.item).sort()).toEqual(['arrow', 'bread']);
      expect(stacks.every((s) => s.count === 1)).toBe(true);
    }
  });

  it('merges repeated drops into one stack and adds nothing for a zero count', () => {
    const tables = new LootTables(
      [
        table('pile', {
          guaranteed: [{ item: ref('arrow'), count: 2 }],
          rolls: { min: 3, max: 3 },
          entries: [
            item('arrow', 1, { count: { min: 4, max: 4 } }),
            item('bread', 1, { count: { min: 0, max: 0 } }),
          ],
        }),
      ],
      ITEMS,
    );
    const counts = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      const { stacks } = tables.roll('pile', Rng.create(seed), { facts: facts() });
      expect(stacks.map((s) => s.item)).toEqual(['arrow']);
      counts.add(stacks[0]?.count ?? 0);
    }
    expect([...counts].sort()).toEqual([10, 14, 2, 6]);
  });

  it('rolls in a world from its loot stream, facts and event bus', () => {
    const world = new World({ seed: 11 });
    world.facts.set(obtainedFactKey('ring'), true);
    const tables = new LootTables(
      [
        table('w', { rolls: once, entries: [item('ring', 1), item('coin', 1)] }),
        table('loop', { rolls: once, entries: [nested('loop', 1)] }),
      ],
      ITEMS,
    );
    const before = world.random(LOOT_RNG_STREAM).serialize();
    expect(tables.rollInWorld(world, 'w', { classId: 'knight' }).stacks).toEqual([
      { item: 'coin', count: 1 },
    ]);
    expect(world.random(LOOT_RNG_STREAM).serialize()).not.toEqual(before);
    const seen: LootDepthExceeded[] = [];
    world.events.on(lootDepthExceeded, (event) => seen.push(event));
    expect(tables.rollInWorld(world, 'loop').error?.chain).toHaveLength(5);
    world.events.flush();
    expect(seen.map((event) => event.tick)).toEqual([world.tick]);
  });

  it('refuses unknown or repeated ids', () => {
    expect(() => new LootTables([table('a'), table('a')], ITEMS)).toThrow(
      'loot table "a" is defined twice',
    );
    expect(() => new LootTables([], [{ id: 'x' }, { id: 'x' }])).toThrow(
      'item "x" is defined twice',
    );
    const tables = new LootTables(
      [
        table('to-nowhere', { rolls: once, entries: [nested('missing', 1)] }),
        table('bad-item', { guaranteed: [{ item: ref('ghost'), count: 1 }] }),
      ],
      ITEMS,
    );
    const roll = (id: string) => () => tables.roll(id, Rng.create(1), { facts: facts() });
    expect(roll('nope')).toThrow(LootReferenceError);
    expect(roll('to-nowhere')).toThrow('loot table "missing" is not defined');
    expect(roll('bad-item')).toThrow('item "ghost" is not defined');
  });
});
