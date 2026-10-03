// The level deltas save section (mw-e27.4 AC-3): every visited level's deltas go into the save and
// back into the world's level delta store; a damaged level is dropped on its own, with a recoverable
// warning, and starts as built while everything else loads.
import {
  defineComponent,
  levelDeltasOf,
  registerPersistence,
  World,
  WorldPersistence,
  type EntityId,
  type LevelDeltas,
  type PersistenceDeclaration,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { decodeSave, encodeSave } from './format';
import {
  LEVEL_DELTAS_SECTION_ID,
  LEVEL_DELTAS_SECTION_VERSION,
  levelDeltasSaveSection,
} from './level-deltas';
import { createGameSaveRegistry } from './sections';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

const Lid = defineComponent<'shut' | 'open'>('test.lid');

const lidPersistence: PersistenceDeclaration<string, string> = {
  key: 'lid',
  capture: (world, entity) => world.get(entity, Lid),
  diff: (baseline, current) => (current === baseline ? undefined : current),
  apply: (world, entity, delta) => {
    if (delta !== 'shut' && delta !== 'open') throw new RangeError(`bad lid "${delta}"`);
    world.set(entity, Lid, delta);
    return true;
  },
};
const persistence = new WorldPersistence({ declarations: [lidPersistence] });

const newWorld = (seed = 1): World<never> => {
  const world = registerPersistence(new World<never>({ seed }));
  world.register(Lid);
  return world;
};

/** Spawns the authored chest of a level, shut. */
const spawnChest = (world: World<never>): [string, EntityId][] => {
  const chest = world.spawn();
  world.add(chest, Lid, 'shut');
  return [['spawn:chest', chest]];
};

const OPENED = (level: string): LevelDeltas => ({
  level,
  entities: [{ id: 'spawn:chest', aspects: { lid: 'open' } }],
  spawned: [{ id: 'spawned:9', kind: 'item', data: { defId: 'healing-draught' } }],
});

/** A save of `world` whose level deltas section data is replaced by `edit(data)`. */
function editLevels(
  bytes: Uint8Array,
  edit: (data: { levels: Record<string, unknown> }) => unknown,
) {
  const decoded = decodeSave(bytes);
  if (!decoded.ok) throw decoded.error;
  const { envelope } = decoded;
  const record = envelope.sections[LEVEL_DELTAS_SECTION_ID];
  const data = edit(record?.data as { levels: Record<string, unknown> });
  return encodeSave({
    ...envelope,
    sections: { ...envelope.sections, [LEVEL_DELTAS_SECTION_ID]: { version: 1, data } },
  });
}

describe('level deltas section', () => {
  it('saves the stored levels and the loaded level, and restores the stored ones', () => {
    const world = newWorld();
    const store = levelDeltasOf(world);
    store.restore([OPENED('crypt')]);
    const authored = spawnChest(world);
    const chest = authored[0]?.[1] ?? -1;
    store.enter(world, persistence, 'nave', authored);
    world.set(chest, Lid, 'open');
    const registry = createGameSaveRegistry();
    const bytes = registry.write(world, options);
    const decoded = decodeSave(bytes);
    expect(decoded.ok && decoded.envelope.sections[LEVEL_DELTAS_SECTION_ID]).toEqual({
      version: LEVEL_DELTAS_SECTION_VERSION,
      data: {
        levels: {
          crypt: { entities: OPENED('crypt').entities, spawned: OPENED('crypt').spawned },
          nave: { entities: [{ id: 'spawn:chest', aspects: { lid: 'open' } }], spawned: [] },
        },
      },
    });

    const loaded = newWorld(4);
    const result = registry.read(loaded, bytes);
    expect(result.ok && result.warnings).toEqual([]);
    expect(levelDeltasOf(loaded).capture(loaded)).toEqual([
      OPENED('crypt'),
      { level: 'nave', entities: OPENED('nave').entities, spawned: [] },
    ]);
  });

  it('AC-3: a damaged level falls back to its baseline with a recoverable error; the rest loads', () => {
    const world = newWorld();
    world.facts.set('bell.rung', true);
    levelDeltasOf(world).restore([OPENED('crypt'), OPENED('nave'), OPENED('tower')]);
    const warn = vi.fn();
    const registry = createGameSaveRegistry({ warn });
    const bytes = editLevels(registry.write(world, options), ({ levels }) => ({
      levels: { ...levels, nave: { entities: [{ id: 7, destroyed: 'yes' }], spawned: [] } },
    }));

    const loaded = newWorld(2);
    const result = registry.read(loaded, bytes);
    if (!result.ok) throw result.error;
    const message =
      'save: changes to level "nave" are damaged (entities.0.id: Invalid input: expected string, received number; entities.0.destroyed: Invalid input: expected true); it starts as built';
    expect(result.warnings).toEqual([
      { kind: 'recovered', section: LEVEL_DELTAS_SECTION_ID, message },
    ]);
    expect(warn).toHaveBeenCalledWith(message);
    // Other sections and levels loaded.
    expect(loaded.facts.get('bell.rung')).toBe(true);
    const store = levelDeltasOf(loaded);
    expect(store.levels()).toEqual(['crypt', 'tower']);
    // The damaged level starts as authored; an intact one gets its changes back.
    const nave = spawnChest(loaded);
    expect(store.enter(loaded, persistence, 'nave', nave).report).toBeUndefined();
    expect(loaded.get(nave[0]?.[1] ?? -1, Lid)).toBe('shut');
    store.leave(loaded);
    const crypt = spawnChest(loaded);
    store.enter(loaded, persistence, 'crypt', crypt);
    expect(loaded.get(crypt[0]?.[1] ?? -1, Lid)).toBe('open');
  });

  it('a damaged section as a whole drops every level’s deltas and loads the rest', () => {
    const world = newWorld();
    levelDeltasOf(world).restore([OPENED('crypt')]);
    const registry = createGameSaveRegistry();
    const bytes = editLevels(registry.write(world, options), () => ['not', 'levels']);
    const loaded = newWorld(2);
    levelDeltasOf(loaded).restore([OPENED('stale')]);
    const result = registry.read(loaded, bytes);
    expect(result.ok && result.warnings.map(({ kind, message }) => [kind, message])).toEqual([
      [
        'recovered',
        'save: level changes are damaged ((root): Invalid input: expected object, received array); every level starts as built',
      ],
    ]);
    expect(levelDeltasOf(loaded).levels()).toEqual([]);
  });

  it('a save from before the section clears the stored deltas without a warning', () => {
    const world = newWorld();
    const bytes = createGameSaveRegistry().write(world, options);
    const decoded = decodeSave(bytes);
    if (!decoded.ok) throw decoded.error;
    const sections = Object.fromEntries(
      Object.entries(decoded.envelope.sections).filter(([id]) => id !== LEVEL_DELTAS_SECTION_ID),
    );
    const loaded = newWorld(2);
    levelDeltasOf(loaded).restore([OPENED('stale')]);
    const result = createGameSaveRegistry().read(
      loaded,
      encodeSave({ ...decoded.envelope, sections }),
    );
    expect(result.ok && result.warnings).toEqual([]);
    expect(levelDeltasOf(loaded).levels()).toEqual([]);
  });

  it('works without a logger', () => {
    const world = newWorld();
    const section = levelDeltasSaveSection();
    const context = { warn: vi.fn(), worldFacts: undefined };
    section.deserialize(world, { levels: { a: 'junk' } }, context);
    expect(context.warn).toHaveBeenCalledTimes(1);
  });
});
