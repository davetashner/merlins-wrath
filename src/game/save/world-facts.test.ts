// The world facts save section (mw-e27.4 AC-2): facts load through the migrations the fact registry
// generates: renamed facts keep their values, removed facts are dropped with a warning, and saves
// from before the section (facts in the world section) get the same treatment.
import { factSchema, type GameEntry } from '@content/index';
import { declareFacts, hashWorld, World } from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { decodeSave, encodeSave, SaveRegistry, WORLD_SECTION_ID } from './format';
import { createGameSaveRegistry } from './sections';
import {
  droppedFactMessage,
  WORLD_FACTS_SECTION_ID,
  WORLD_FACTS_SECTION_VERSION,
} from './world-facts';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

/** A fact registry group as content declares it. */
const registryGroup = factSchema.parse({
  id: 'cellar',
  name: 'Cellar facts',
  notes: 'Test registry for mw-e27.4.',
  facts: [
    {
      key: 'door.cellar.open',
      type: 'bool',
      default: false,
      description: 'The cellar door is open.',
      owner: 'interaction',
      renamedFrom: ['cellar_door_open'],
    },
    {
      key: 'cellar.visits',
      type: 'int',
      default: 0,
      description: 'Times the player went down.',
      owner: 'quest',
    },
  ],
}) as unknown as GameEntry<'fact'>;

/** A world whose fact store declares the registry, strict about anything else, as dev builds are. */
const registryWorld = (seed = 1): World => {
  const world = new World({ seed });
  declareFacts(world.facts, [registryGroup], { mode: 'throw' });
  return world;
};

/** A save from `registry` with the world-facts section's record replaced. */
function withFactsRecord(version: number, facts: Record<string, unknown>): Uint8Array {
  const decoded = decodeSave(createGameSaveRegistry().write(new World({ seed: 5 }), options));
  if (!decoded.ok) throw decoded.error;
  const { envelope } = decoded;
  return encodeSave({
    ...envelope,
    sections: { ...envelope.sections, [WORLD_FACTS_SECTION_ID]: { version, data: { facts } } },
  });
}

describe('world facts section', () => {
  it('saves every fact in its own section and restores them with the state hash', () => {
    const registry = createGameSaveRegistry();
    const world = registryWorld();
    world.facts.set('door.cellar.open', true);
    world.facts.set('cellar.visits', 3);
    world.step();
    const bytes = registry.write(world, options);
    const decoded = decodeSave(bytes);
    expect(decoded.ok && decoded.envelope.sections[WORLD_FACTS_SECTION_ID]).toEqual({
      version: WORLD_FACTS_SECTION_VERSION,
      data: { facts: { 'cellar.visits': 3, 'door.cellar.open': true } },
    });
    expect(decoded.ok && decoded.envelope.sections[WORLD_SECTION_ID]?.data).not.toHaveProperty(
      'facts',
    );
    const loaded = registryWorld(9);
    loaded.facts.set('cellar.visits', 8);
    const result = registry.read(loaded, bytes);
    expect(result.ok && result.warnings).toEqual([]);
    expect(loaded.facts.snapshot()).toEqual(world.facts.snapshot());
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it('AC-2: a v1 save holding "cellar_door_open" loads it as "door.cellar.open" with its value', () => {
    const warn = vi.fn();
    const registry = createGameSaveRegistry({ warn });
    for (const value of [true, false]) {
      const world = registryWorld();
      const result = registry.read(world, withFactsRecord(1, { cellar_door_open: value }));
      expect(result).toMatchObject({ ok: true, warnings: [] });
      expect(world.facts.has('door.cellar.open')).toBe(true);
      expect(world.facts.get('door.cellar.open')).toBe(value);
      expect(world.facts.has('cellar_door_open')).toBe(false);
    }
    expect(warn).toHaveBeenCalledWith(
      'save: fact "cellar_door_open" loaded as "door.cellar.open" (renamed)',
    );
  });

  it('drops facts the registry no longer declares or accepts, reports them and loads the rest', () => {
    const warn = vi.fn();
    const world = registryWorld();
    const result = createGameSaveRegistry({ warn }).read(
      world,
      withFactsRecord(1, {
        'cellar.visits': 2,
        'door.cellar.open': 'wide',
        'removed.fact': true,
      }),
    );
    const messages = [
      'save: dropped fact "door.cellar.open" = "wide": its value no longer fits the fact',
      'save: dropped fact "removed.fact" = true: the fact is no longer declared',
    ];
    expect(result.ok && result.warnings).toEqual(
      messages.map((message) => ({ kind: 'recovered', section: WORLD_FACTS_SECTION_ID, message })),
    );
    expect(warn.mock.calls.map(([message]) => message as string)).toEqual(messages);
    expect(world.facts.snapshot()).toEqual({ 'cellar.visits': 2 });
  });

  it('a save from before the section (facts in the world section) migrates the same way', () => {
    const old = new World({ seed: 3 });
    old.facts.set('cellar.open', true); // a key the registry has since dropped
    old.facts.set('cellar.visits', 4);
    const bytes = new SaveRegistry().write(old, options);
    const world = registryWorld();
    const result = createGameSaveRegistry().read(world, bytes);
    expect(result.ok && result.warnings.map((w) => [w.kind, w.section])).toEqual([
      ['missing-section', 'inventory'],
      ['recovered', WORLD_FACTS_SECTION_ID],
    ]);
    expect(world.facts.snapshot()).toEqual({ 'cellar.visits': 4 });
    // Without a registry (inferred facts), every legacy fact loads as it was.
    const plain = new World({ seed: 1 });
    expect(createGameSaveRegistry().read(plain, bytes)).toMatchObject({ ok: true });
    expect(plain.facts.snapshot()).toEqual(old.facts.snapshot());
    expect(hashWorld(plain)).toBe(hashWorld(old));
  });

  it('words every drop reason', () => {
    expect(droppedFactMessage({ key: 'a', value: 1, reason: 'superseded' })).toBe(
      'save: dropped fact "a" = 1: the save also holds the fact under its current key',
    );
  });
});
