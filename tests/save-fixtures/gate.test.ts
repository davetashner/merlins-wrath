// The save-schema gate (mw-e30.3, backlog contract §3), run on every CI build: the committed schema
// lock must match this build's save sections, and every committed fixture — from every revision,
// oldest first — must load through the current migration chain into a world that passes its
// invariants. On failure the message says exactly what to do (bump + migrate + pnpm save:fixture).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { decodeSave } from '@game/save/format';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  brainOf,
  captureCreatures,
  captureInventories,
  conditionOf,
  CreatureComponent,
  isUnconscious,
  levelDeltasOf,
  replayScenarios,
  type World,
  type WorldSnapshot,
} from '@sim/index';
import { checkSaveFixtures, listFixtures, loadFixtureFile } from '@tools/save-fixtures/files';
import { parseFixture } from '@tools/save-fixtures/fixtures';
import { FIXTURE_SCENARIOS } from '@tools/save-fixtures/scenarios';

const root = process.cwd();
const fixtures = Object.values(listFixtures(root)).flat();

describe('save schema gate', () => {
  it('AC-2/AC-3: the schema lock matches every save section and each revision has fixtures', () => {
    const problems = checkSaveFixtures(root, createGameSaveRegistry());
    expect(problems.map((problem) => problem.message).join('\n')).toBe('');
  });

  it('AC-1: finds fixtures for revision 1', () => {
    expect(fixtures.filter((path) => path.includes('/1/')).length).toBeGreaterThan(0);
  });

  it.each(fixtures)('AC-1: %s loads under the current build and passes invariants', (path) => {
    const { world } = loadFixtureFile(root, path, createGameSaveRegistry());
    expect(world.tick).toBeGreaterThan(0);
  });
});

describe('inventory fixture (mw-e17.8)', () => {
  it('AC-3: the committed v1 inventory save loads with its pack, equipment and quick slots', () => {
    const content = loadGameContent();
    const registry = createGameSaveRegistry({ knownItem: (id) => content.has('item', id) });
    const path = 'tests/save-fixtures/4/core-inventory.json';
    const { world } = loadFixtureFile(root, path, registry);
    const [actor] = captureInventories(world).actors;
    expect(actor?.inventory?.items.map((item) => item.defId)).toContain('healing-draught');
    expect(actor?.inventory?.items.some((item) => item.flags.stolen === true)).toBe(true);
    expect(actor?.equipment?.slots['main-hand']?.defId).toBe('arming-sword');
    const slot = actor?.quickSlots?.slots[0];
    expect(slot?.defId).toBe('healing-draught');
    const bound = actor?.inventory?.items.find((item) => item.instanceId === slot?.instanceId);
    expect(bound).toMatchObject({ defId: 'healing-draught', count: 10 });
  });
});

describe('world state fixtures (mw-e27.4)', () => {
  const previous = fixtures.filter((path) => path.includes('/4/'));

  it.each(previous)(
    'AC-5: %s, written by the previous release, loads in the current build without error',
    (path) => {
      const fixture = parseFixture(JSON.parse(readFileSync(path, 'utf8')));
      const registry = createGameSaveRegistry();
      const world = replayScenarios[fixture.scenario]?.create({ seed: fixture.seed, hz: 60 });
      if (world === undefined) throw new Error(`no scenario ${fixture.scenario}`);
      const result = registry.read(world, Buffer.from(fixture.save, 'base64'));
      if (!result.ok) throw result.error;
      // No world-facts or level-deltas section yet: their missing hooks take over, unwarned.
      expect(result.warnings).toEqual([]);
      expect(levelDeltasOf(world).levels()).toEqual([]);
      // The facts the world section held are in the store, and the next save moves them.
      const decoded = decodeSave(Buffer.from(fixture.save, 'base64'));
      const saved = decoded.ok ? (decoded.envelope.sections['world']?.data as WorldSnapshot) : null;
      expect(world.facts.snapshot()).toEqual(saved?.facts ?? {});
      expect(world.tick).toBe(fixture.ticks);
    },
  );

  it('the world-state fixture brings back its facts and both levels’ changes', () => {
    const { world } = loadFixtureFile(
      root,
      'tests/save-fixtures/5/core-world-state.json',
      createGameSaveRegistry(),
    );
    expect(world.facts.get('entity:testbed/closet-door.opened')).toBe(true);
    const store = levelDeltasOf(world);
    expect(store.levels()).toEqual(['mechanism-room', 'testbed']);
    expect(store.deltas('testbed')?.entities.map(({ id }) => id)).toEqual([
      'piece:6',
      'spawn:closet-door',
      'spawn:testbed-draught',
      'spawn:loose-crate',
    ]);
  });
});

describe('creature fixtures (mw-e12.14)', () => {
  const previous = fixtures.filter((path) => path.includes('/5/'));

  it.each(previous)(
    '%s, written before the creatures section, loads in the current build without warnings',
    (path) => {
      const fixture = parseFixture(JSON.parse(readFileSync(path, 'utf8')));
      const world = FIXTURE_SCENARIOS[fixture.scenario]?.create({ seed: fixture.seed, hz: 60 });
      if (world === undefined) throw new Error(`no scenario ${fixture.scenario}`);
      const result = createGameSaveRegistry().read(world, Buffer.from(fixture.save, 'base64'));
      if (!result.ok) throw result.error;
      expect(result.warnings).toEqual([]);
      expect(captureCreatures(world as World<never>)).toEqual({ creatures: [] });
    },
  );

  it('the creature-guards save brings back the searching guard and the knocked-out sleeper', () => {
    const { world } = loadFixtureFile(
      root,
      'tests/save-fixtures/6/creature-guards.json',
      createGameSaveRegistry(),
    );
    const w = world as World<never>;
    const byPoint = new Map(
      w
        .query(CreatureComponent)
        .ids()
        .map((entity) => [w.get(entity, CreatureComponent)?.origin.point, entity]),
    );
    const guard = brainOf(w, byPoint.get('guard') ?? 0);
    expect(guard?.state).toBe('searching');
    expect(guard?.blackboard.lkp).not.toBeNull();
    expect(guard?.awareness.length).toBeGreaterThan(0);
    const sleeper = byPoint.get('sleeper') ?? 0;
    expect(conditionOf(w, sleeper)?.morale).toBe(100);
    expect(isUnconscious(w, sleeper)).toBe(true);
  });
});
