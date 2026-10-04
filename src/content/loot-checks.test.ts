import { describe, expect, it } from 'vitest';
import { gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource, type LoadedEntry } from './loader.ts';
import { checkLootTables, lootTableProblems } from './loot-checks.ts';
import { contentChecks, contentTypes } from './registry.ts';
import { lootTableSchema, type LootTableInput } from './types/loot-table.ts';
import type { SceneDef } from './types/scene.ts';

const table = (input: Omit<LootTableInput, 'notes'>): LoadedEntry => ({
  type: 'loot-table',
  file: `t/${input.id}.json`,
  value: lootTableSchema.parse({ notes: 'A test table.', ...input }),
});
const item = (id: string, unique = false): LoadedEntry => {
  const value = { id, flags: { unique } };
  return { type: 'item', file: `i/${id}.json`, value };
};
const creature = (id: string, loot?: string): LoadedEntry => {
  const value = loot === undefined ? { id } : { id, loot };
  return { type: 'creature', file: `c/${id}.json`, value };
};
/** Tables that each roll the next: `chain('a', 'b')` is a > b. */
const chain = (...ids: string[]): LoadedEntry[] =>
  ids.map((id, i) => {
    const next = ids[i + 1];
    return next === undefined
      ? table({ id, guaranteed: [{ item: 'bread' }] })
      : table({ id, rolls: { min: 1, max: 1 }, entries: [{ table: next, weight: 1 }] });
  });

const errors = (entries: readonly LoadedEntry[]) =>
  lootTableProblems(entries).errors.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
const warnings = (entries: readonly LoadedEntry[]) =>
  lootTableProblems(entries).warnings.map((i) => `${i.file}#${i.pointer}: ${i.message}`);

/** Every problem loading the game content plus `extra` files. */
function loadIssues(
  extra: readonly ContentSource[],
  edit: (source: ContentSource) => ContentSource = (source) => source,
): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources().map(edit), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}
const lootFile = (input: Omit<LootTableInput, 'notes'>) => ({
  path: `src/content/data/loot-table/${input.id}.json`,
  text: JSON.stringify({ notes: 'A test table.', ...input }),
});

describe('loot-table validator (mw-e18.2)', () => {
  it('AC-1: a table naming a missing item fails, naming the table, entry index and missing id', () => {
    const entries = [
      item('bread'),
      creature('rat', 'scraps'),
      table({
        id: 'scraps',
        guaranteed: [{ item: 'bread' }, { item: 'cheese' }],
        rolls: { min: 1, max: 1 },
        entries: [
          { item: 'bread', weight: 2 },
          { item: 'ghost-sword', weight: 1 },
          { table: 'nowhere', weight: 1 },
        ],
      }),
    ];
    expect(errors(entries)).toEqual([
      't/scraps.json#/guaranteed/1/item: loot-table:scraps guaranteed[1] names missing item "cheese"',
      't/scraps.json#/entries/1/item: loot-table:scraps entries[1] names missing item "ghost-sword"',
      't/scraps.json#/entries/2/table: loot-table:scraps entries[2] names missing loot-table "nowhere"',
    ]);
  });

  it('AC-1: a creature whose loot names a missing table fails on load', () => {
    expect(errors([item('bread'), creature('rat', 'scraps'), creature('bat')])).toEqual([
      'c/rat.json#/loot: creature:rat loot names missing loot-table "scraps"',
    ]);
    const miner = 'src/content/data/creature/forgotten-miner.json';
    const issues = loadIssues([], (source) =>
      source.path === miner
        ? {
            ...source,
            text: JSON.stringify({ ...JSON.parse(source.text), loot: 'miner-scraps' }),
          }
        : source,
    );
    expect(issues).toEqual([
      `${miner}#/loot: creature:forgotten-miner loot names missing loot-table "miner-scraps"`,
    ]);
  });

  it('AC-2: tables A > B > A fail, reporting the cycle path', () => {
    const entries = [
      item('bread'),
      table({ id: 'a', rolls: { min: 1, max: 1 }, entries: [{ table: 'b', weight: 1 }] }),
      table({
        id: 'b',
        rolls: { min: 1, max: 1 },
        entries: [
          { item: 'bread', weight: 1 },
          { table: 'a', weight: 1 },
        ],
      }),
    ];
    expect(errors(entries)).toEqual([
      't/b.json#/entries/1/table: loot-table:b entries[1] closes a cycle of nested tables: a > b > a',
    ]);
  });

  it('AC-2: a table rolling itself is a cycle, and a cycle fails the content load', () => {
    expect(
      errors([table({ id: 'a', rolls: { min: 1, max: 1 }, entries: [{ table: 'a', weight: 1 }] })]),
    ).toEqual([
      't/a.json#/entries/0/table: loot-table:a entries[0] closes a cycle of nested tables: a > a',
    ]);
    expect(
      loadIssues([
        lootFile({
          id: 'zz-a',
          rolls: { min: 1, max: 1 },
          entries: [{ table: 'zz-b', weight: 1 }],
        }),
        lootFile({
          id: 'zz-b',
          rolls: { min: 1, max: 1 },
          entries: [{ table: 'zz-a', weight: 1 }],
        }),
      ]),
    ).toEqual([
      'src/content/data/loot-table/zz-b.json#/entries/0/table: loot-table:zz-b entries[0] closes a cycle of nested tables: zz-a > zz-b > zz-a',
    ]);
  });

  it('a table reached twice without a loop (a diamond) is not a cycle', () => {
    const entries = [
      item('bread'),
      table({
        id: 'a',
        rolls: { min: 1, max: 1 },
        entries: [
          { table: 'b', weight: 1 },
          { table: 'c', weight: 1 },
        ],
      }),
      ...chain('b', 'd'),
      ...chain('c', 'd').slice(0, 1),
    ];
    expect(errors(entries)).toEqual([]);
  });

  it('nesting deeper than LOOT_MAX_DEPTH fails at load, naming the chain', () => {
    expect(errors([item('bread'), ...chain('a', 'b', 'c', 'd')])).toEqual([]);
    expect(errors([item('bread'), ...chain('a', 'b', 'c', 'd', 'e', 'f')])).toEqual([
      't/a.json#/entries: loot-table:a nests 6 tables deep (a > b > c > d > e > f); the most is 4',
      't/b.json#/entries: loot-table:b nests 5 tables deep (b > c > d > e > f); the most is 4',
    ]);
  });

  it('a table that rolls with no entries fails (it would silently drop nothing)', () => {
    expect(errors([table({ id: 'empty', rolls: { min: 1, max: 2 } })])).toEqual([
      't/empty.json#/rolls: loot-table:empty rolls up to 2 times but has no entries to roll',
    ]);
  });

  it('weights below 1 and inverted count ranges are rejected by the schema at load', () => {
    expect(
      loadIssues([
        lootFile({
          id: 'zz-bad',
          rolls: { min: 2, max: 1 },
          entries: [{ item: 'oil-flask', weight: 0, count: { min: 3, max: 1 } }],
        }),
      ]).map((i) => i.split('#')[1]),
    ).toEqual([
      '/rolls/max: min must not exceed max (at rolls.max)',
      expect.stringMatching(/^\/entries\/0\/weight: /),
      '/entries/0/count/max: min must not exceed max (at entries[0].count.max)',
    ]);
  });

  it('AC-3: a unique artifact guaranteed in two placements fails, listing both', () => {
    const entries = [
      item('vesper-bell', true),
      table({ id: 'altar', guaranteed: [{ item: 'vesper-bell' }] }),
      table({ id: 'reliquary', guaranteed: [{ item: 'vesper-bell' }] }),
    ];
    expect(errors(entries)).toEqual([
      't/altar.json#/guaranteed/0: unique item "vesper-bell" is guaranteed in 2 placements; it may be guaranteed in at most one: loot-table:altar guaranteed[0], loot-table:reliquary guaranteed[0]',
    ]);
  });

  it('AC-3: a table guaranteeing a unique item counts once per creature that drops it', () => {
    const entries = [
      item('bread'),
      item('crown', true),
      item('sceptre', true),
      item('ring', false),
      creature('king', 'regalia'),
      creature('pretender', 'regalia'),
      creature('steward', 'pantry'),
      table({ id: 'regalia', guaranteed: [{ item: 'crown' }, { item: 'ring' }] }),
      table({ id: 'treasury', guaranteed: [{ item: 'sceptre' }] }),
      table({ id: 'pantry', guaranteed: [{ item: 'bread', count: 3 }, { item: 'ring' }] }),
    ];
    expect(errors(entries)).toEqual([
      't/regalia.json#/guaranteed/0: unique item "crown" is guaranteed in 2 placements; it may be guaranteed in at most one: creature:king (via loot-table:regalia guaranteed[0]), creature:pretender (via loot-table:regalia guaranteed[0])',
    ]);
    expect(errors(entries.filter((e) => e.value.id !== 'pretender'))).toEqual([]);
  });

  it('AC-3: a unique item guaranteed more than one unit at a time fails', () => {
    expect(
      errors([
        item('crown', true),
        table({ id: 'hoard', guaranteed: [{ item: 'crown', count: 2 }] }),
      ]),
    ).toEqual([
      't/hoard.json#/guaranteed/0/count: loot-table:hoard guaranteed[0] guarantees 2 of unique item "crown"; a unique item drops once',
    ]);
  });

  it('AC-4: an unreferenced table is a warning, not an error', () => {
    const entries = [
      item('bread'),
      creature('rat', 'scraps'),
      ...chain('scraps', 'crumbs'),
      table({ id: 'orphan', guaranteed: [{ item: 'bread' }] }),
      table({
        id: 'ouroboros',
        rolls: { min: 1, max: 1 },
        entries: [{ table: 'ouroboros', weight: 1 }],
      }),
    ];
    const found = lootTableProblems(entries);
    expect(warnings(entries)).toEqual([
      't/orphan.json#: loot-table:orphan is not referenced by any creature, container or loot table',
      't/ouroboros.json#: loot-table:ouroboros is not referenced by any creature, container or loot table',
    ]);
    expect(found.errors.map((e) => e.message)).toEqual([
      'loot-table:ouroboros entries[0] closes a cycle of nested tables: ouroboros > ouroboros',
    ]);
    expect(checkLootTables(entries.filter((e) => e.value.id !== 'ouroboros'))).toEqual([]);
  });

  it('AC-5: the repository loot content validates with no errors', () => {
    let entries: readonly LoadedEntry[] = [];
    loadContent(contentTypes, gameContentSources(), [
      ...contentChecks,
      (loaded) => {
        entries = loaded;
        return [];
      },
    ]);
    expect(entries.some((e) => e.type === 'loot-table')).toBe(true);
    expect(lootTableProblems(entries).errors).toEqual([]);
  });
});

/** A scene whose spawns are containers: spawn id → its loot table and contents. */
const scene = (
  id: string,
  containers: Record<string, { loot?: string; contents?: [string, number][] }>,
): LoadedEntry => {
  const value = {
    id,
    spawns: [
      { id: 'marker' },
      ...Object.entries(containers).map(([spawn, { loot, contents = [] }]) => ({
        id: spawn,
        container: {
          ...(loot !== undefined && { loot: { id: loot } }),
          contents: contents.map(([item, count]) => ({ item: { id: item }, count })),
        },
      })),
    ],
  };
  return { type: 'scene', file: `s/${id}.json`, value };
};

describe('loot-table validator: scene containers (mw-e18.3)', () => {
  it('a container rolling a table references it; one naming a missing table fails', () => {
    const entries = [
      item('bread'),
      table({ id: 'pantry', guaranteed: [{ item: 'bread' }] }),
      scene('cellar', { larder: { loot: 'pantry' }, crate: { loot: 'nowhere' }, shelf: {} }),
    ];
    expect(warnings(entries)).toEqual([]);
    expect(errors(entries)).toEqual([
      's/cellar.json#/spawns/2/container/loot: scene:cellar/crate loot names missing loot-table "nowhere"',
    ]);
  });

  it('a unique item counts once per container that rolls its table, and once per container holding it', () => {
    const entries = [
      item('bread'),
      item('crown', true),
      table({ id: 'regalia', guaranteed: [{ item: 'crown' }] }),
      scene('keep', {
        throne: { loot: 'regalia' },
        vault: {
          contents: [
            ['crown', 2],
            ['bread', 3],
          ],
        },
      }),
    ];
    expect(errors(entries)).toEqual([
      's/keep.json#/spawns/2/container/contents/0/count: scene:keep/vault contents[0] holds 2 of unique item "crown"; a unique item drops once',
      't/regalia.json#/guaranteed/0: unique item "crown" is guaranteed in 2 placements; it may be guaranteed in at most one: scene:keep/throne (via loot-table:regalia guaranteed[0]), scene:keep/vault contents[0]',
    ]);
    const once = [item('crown', true), scene('keep', { vault: { contents: [['crown', 1]] } })];
    expect(errors(once)).toEqual([]);
  });
});

/** A scene placing creatures: spawn id → its creature and what it carries. */
const creatureScene = (
  id: string,
  spawns: Record<string, { creature: string; carries?: [string, number][] }>,
): LoadedEntry => {
  const value = {
    id,
    spawns: Object.entries(spawns).map(([spawn, { creature, carries }]) => ({
      id: spawn,
      creature: { id: creature },
      ...(carries !== undefined && {
        carries: carries.map(([item, count]) => ({ item: { id: item }, count })),
      }),
    })),
  };
  return { type: 'scene', file: `s/${id}.json`, value };
};

describe('loot-table validator: creature drops (mw-e01.5)', () => {
  it('AC-2: a creature’s table guaranteeing a unique item counts once per scene spawn of that creature', () => {
    const entries = [
      item('crown', true),
      creature('king', 'regalia'),
      table({ id: 'regalia', guaranteed: [{ item: 'crown' }] }),
      creatureScene('hall', { throne: { creature: 'king' }, dais: { creature: 'king' } }),
    ];
    expect(warnings(entries)).toEqual([]);
    expect(errors(entries)).toEqual([
      't/regalia.json#/guaranteed/0: unique item "crown" is guaranteed in 2 placements; it may be guaranteed in at most one: scene:hall/throne (creature:king) (via loot-table:regalia guaranteed[0]), scene:hall/dais (creature:king) (via loot-table:regalia guaranteed[0])',
    ]);
    const once = entries.map((e) =>
      e.type === 'scene' ? creatureScene('hall', { throne: { creature: 'king' } }) : e,
    );
    expect(errors(once)).toEqual([]);
  });

  it('AC-2: a placed creature’s table that is missing fails once, however often it is placed', () => {
    const entries = [
      creature('rat', 'scraps'),
      creatureScene('cellar', { a: { creature: 'rat' }, b: { creature: 'rat' } }),
    ];
    expect(errors(entries)).toEqual([
      'c/rat.json#/loot: creature:rat loot names missing loot-table "scraps"',
    ]);
  });

  it('AC-2: a unique item a placed creature carries is a placement of its own, one unit at a time', () => {
    const entries = [
      item('bread'),
      item('key', true),
      table({ id: 'lockbox', guaranteed: [{ item: 'key' }] }),
      creatureScene('mine', {
        miner: {
          creature: 'miner',
          carries: [
            ['key', 2],
            ['bread', 3],
          ],
        },
      }),
    ];
    expect(errors(entries)).toEqual([
      's/mine.json#/spawns/0/carries/0/count: scene:mine/miner carries[0] holds 2 of unique item "key"; a unique item drops once',
      't/lockbox.json#/guaranteed/0: unique item "key" is guaranteed in 2 placements; it may be guaranteed in at most one: loot-table:lockbox guaranteed[0], scene:mine/miner carries[0]',
    ]);
    const once = [
      item('key', true),
      creatureScene('mine', { miner: { creature: 'miner', carries: [['key', 1]] } }),
    ];
    expect(errors(once)).toEqual([]);
  });

  it('AC-2: the slice skeleton is the one placement of the rusted gallery key', () => {
    let entries: readonly LoadedEntry[] = [];
    loadContent(contentTypes, gameContentSources(), [
      ...contentChecks,
      (loaded) => {
        entries = loaded;
        return [];
      },
    ]);
    const twice = entries.map((e): LoadedEntry => {
      if (e.type !== 'scene' || e.value.id !== 'slice') return e;
      const scene = e.value as SceneDef;
      const skeleton = scene.spawns.find((s) => s.id === 'skeleton');
      const spawns = [...scene.spawns, { ...skeleton, id: 'skeleton-2' }];
      const value: SceneDef = { ...scene, spawns: spawns as SceneDef['spawns'] };
      return { ...e, value };
    });
    expect(lootTableProblems(entries).errors).toEqual([]);
    expect(lootTableProblems(twice).errors.map((e) => e.message)).toEqual([
      'unique item "rusted-gallery-key" is guaranteed in 2 placements; it may be guaranteed in at most one: scene:slice/skeleton carries[0], scene:slice/skeleton-2 carries[0]',
    ]);
  });
});
