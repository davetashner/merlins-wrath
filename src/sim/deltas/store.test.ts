// The per-world level delta store (mw-e27.4): one live level, every other visited level's deltas
// stored as data and applied only when that level is entered again.
import { describe, expect, it } from 'vitest';
import { defineComponent, type EntityId } from '../core/component';
import { World } from '../core/world';
import type { PersistenceDeclaration } from './declarations';
import { registerPersistence, WorldPersistence, type LevelDeltas } from './persistence';
import { hashLevelDeltas, LevelDeltaStore, levelDeltasOf } from './store';

const Mark = defineComponent<number>('test.mark');

/** Persists `test.mark` as its value whenever it differs from the baseline. */
const markPersistence: PersistenceDeclaration<number, number> = {
  key: 'mark',
  capture: (world, entity) => world.get(entity, Mark),
  diff: (baseline, current) =>
    current === undefined || current === baseline ? undefined : current,
  apply: (world, entity, delta) => {
    world.set(entity, Mark, delta);
    return true;
  },
};

const persistence = new WorldPersistence({ declarations: [markPersistence] });

const newWorld = (): World<never> => {
  const world = registerPersistence(new World<never>({ seed: 3 }));
  world.register(Mark);
  return world;
};

/** Spawns a level of `n` marked entities (`e0`, `e1`…, all marked 0). */
const spawnLevel = (world: World<never>, n: number): [string, EntityId][] =>
  Array.from({ length: n }, (_, i) => {
    const entity = world.spawn();
    world.add(entity, Mark, 0);
    return [`e${String(i)}`, entity];
  });

describe('LevelDeltaStore', () => {
  it('keeps a left level’s deltas and applies them only when it is entered again', () => {
    const world = newWorld();
    const store = new LevelDeltaStore();
    expect(store.current).toBeUndefined();
    const first = spawnLevel(world, 2);
    const entered = store.enter(world, persistence, 'crypt', first);
    expect(entered.report).toBeUndefined();
    expect(store.current).toBe('crypt');
    world.set(first[1]?.[1] ?? -1, Mark, 7);
    world.destroy(first[0]?.[1] ?? -1);

    const left = store.leave(world);
    expect(left).toEqual({
      level: 'crypt',
      entities: [
        { id: 'e0', destroyed: true },
        { id: 'e1', aspects: { mark: 7 } },
      ],
      spawned: [],
    });
    expect(store.current).toBeUndefined();
    expect(store.levels()).toEqual(['crypt']);
    expect(store.deltas('crypt')).toBe(left);

    // Somewhere else, then back: the crypt spawns from data and its deltas apply.
    store.enter(world, persistence, 'nave', spawnLevel(world, 1));
    expect(store.capture(world).map(({ level }) => level)).toEqual(['crypt', 'nave']);
    store.leave(world);
    const again = spawnLevel(world, 2);
    const back = store.enter(world, persistence, 'crypt', again);
    expect(back.report?.applied).toBe(2);
    expect(world.isAlive(again[0]?.[1] ?? -1)).toBe(false);
    expect(world.get(again[1]?.[1] ?? -1, Mark)).toBe(7);
    expect(store.deltas('crypt')).toBeUndefined();
    expect(store.levels()).toEqual(['nave']);
  });

  it('refuses a second level while one is loaded, and leaving with none', () => {
    const world = newWorld();
    const store = new LevelDeltaStore();
    expect(store.capture(world)).toEqual([]);
    expect(() => store.leave(world)).toThrow('no level is loaded');
    store.enter(world, persistence, 'crypt', []);
    expect(() => store.enter(world, persistence, 'nave', [])).toThrow(
      'level "nave" entered while "crypt" is still loaded',
    );
  });

  it('restore replaces the stored deltas but leaves the loaded level to the live world', () => {
    const world = newWorld();
    const store = new LevelDeltaStore();
    const saved: LevelDeltas[] = [
      { level: 'nave', entities: [{ id: 'e0', destroyed: true }], spawned: [] },
      { level: 'crypt', entities: [{ id: 'e0', aspects: { mark: 2 } }], spawned: [] },
    ];
    store.restore(saved);
    expect(store.levels()).toEqual(['crypt', 'nave']);
    const level = spawnLevel(world, 1);
    store.enter(world, persistence, 'crypt', level);
    expect(world.get(level[0]?.[1] ?? -1, Mark)).toBe(2);
    store.restore([
      { level: 'crypt', entities: [{ id: 'e0', aspects: { mark: 9 } }], spawned: [] },
      { level: 'tower', entities: [], spawned: [] },
    ]);
    expect(store.levels()).toEqual(['tower']);
    expect(world.get(level[0]?.[1] ?? -1, Mark)).toBe(2);
    expect(store.capture(world)).toEqual([
      { level: 'crypt', entities: [{ id: 'e0', aspects: { mark: 2 } }], spawned: [] },
      { level: 'tower', entities: [], spawned: [] },
    ]);
  });

  it('hashes deltas independent of level order and sensitive to content', () => {
    const a: LevelDeltas = { level: 'a', entities: [], spawned: [] };
    const b: LevelDeltas = { level: 'b', entities: [{ id: 'x', destroyed: true }], spawned: [] };
    expect(hashLevelDeltas([a, b])).toMatch(/^[0-9a-f]{8}$/);
    expect(hashLevelDeltas([b, a])).toBe(hashLevelDeltas([a, b]));
    expect(hashLevelDeltas([a])).not.toBe(hashLevelDeltas([a, b]));
  });

  it('levelDeltasOf gives each world one store of its own', () => {
    const world = newWorld();
    const store = levelDeltasOf(world);
    expect(levelDeltasOf(world)).toBe(store);
    expect(levelDeltasOf(newWorld())).not.toBe(store);
  });
});
