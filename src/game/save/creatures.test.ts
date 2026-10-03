// The creatures save section (mw-e12.14 AC-1, AC-3, AC-4): a searching guard keeps its state, the
// time its search has left and its last-known position across a save and load; a v1 save (before
// creatures had a condition) migrates to v2 with full morale; a knocked-out creature stays out with
// its wake timer.
import { compileCreatures, controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  aiScenario,
  brainOf,
  BrainComponent,
  buildFactionTable,
  captureCreatures,
  compileBehaviours,
  conditionOf,
  CreatureComponent,
  CreatureConditionComponent,
  factionSpecFromDef,
  hashWorld,
  isUnconscious,
  knockOut,
  queueAiEvent,
  PerceptionAgentComponent,
  wakeTicksLeft,
  World,
  writeBlackboard,
  type EntityId,
  type ScenarioDeps,
  type ScenarioStart,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  addCreatureConditions,
  CREATURES_MIGRATIONS,
  CREATURES_SECTION_ID,
  CREATURES_SECTION_VERSION,
  creaturesSaveSection,
} from './creatures';
import { decodeSave, encodeSave, migrateSection, validateSection } from './format';
import { createGameSaveRegistry } from './sections';

const content = loadFixtureContent();
const deps: ScenarioDeps = {
  creatures: compileCreatures(content.all('creature'), content),
  factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
  behaviours: compileBehaviours(content.all('behaviour')),
  controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
};
const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };

/** The fixture guard's search timeout (its behaviour's `searchingTimeoutS`). */
const SEARCH_S = 60;

/**
 * A lit hall: the fixture guard at its post facing +z, and a second guard behind the west wall. The
 * player, far outside, throws a stone into the hall 52 s in. `alarmed` raises an ally's alarm about
 * a spot in the torchlight, so the guard hunts there and then searches it.
 */
const hall = aiScenario(
  {
    name: 'creature-saves',
    layout: {
      id: 'creature-saves',
      walls: [
        { min: [-12, 0, 3], max: [-5, 3, 4] },
        { min: [5, 0, 3], max: [12, 3, 4] },
        { min: [-12, 0, 12], max: [12, 3, 12.5] },
      ],
      light: {
        ambient: 0.2,
        lights: [{ id: 'torch', at: [0, 2.5, 6], intensity: 250, radius: 12 }],
      },
      player: { at: [-60, 0, -60], yaw: 90 },
      fixtures: [
        { id: 'guard', creature: 'fixture-guard', at: [0, 0, 0], patrol: [[0, 0, 0]] },
        { id: 'sleeper', creature: 'fixture-guard', at: [-9, 0, -6], patrol: [[-9, 0, -6]] },
      ],
    },
    player: [{ wait: 52 }, { throw: [2, 0, 7], db: 65 }],
    duration: 120,
  },
  deps,
);

function agent(start: ScenarioStart, id: string): EntityId {
  const entity = start.agents.get(id);
  if (entity === undefined) throw new Error(`no ${id}`);
  return entity;
}

/** A world as the sim's queries take it. */
const sim = (world: World): World<never> => world;

/** Steps a scenario's world `ticks` times with its player's commands. */
function run(start: ScenarioStart, ticks: number): void {
  for (let i = 0; i < ticks; i++) start.world.step(start.drive(start.world.tick));
}

/** A start of the hall whose guard has just been told of an intruder at (3, 0, 8). */
function alarmed(): ScenarioStart {
  const start = hall.start();
  const guard = agent(start, 'guard');
  writeBlackboard(sim(start.world), guard, { lkp: { x: 3, y: 0, z: 8 } });
  queueAiEvent(sim(start.world), guard, 'ally-alarm');
  return start;
}

/** Saves `world` and loads it into a fresh start of the hall; returns the loaded world. */
function reload(world: World): World {
  const registry = createGameSaveRegistry();
  const loaded = hall.start().world;
  const result = registry.read(loaded, registry.write(world, saveOptions));
  if (!result.ok) throw result.error;
  expect(result.warnings).toEqual([]);
  return loaded;
}

/** The creatures section's record, rewritten to `version` with `edit` applied to its data. */
function rewrite(bytes: Uint8Array, version: number, edit: (data: unknown) => unknown) {
  const decoded = decodeSave(bytes);
  if (!decoded.ok) throw decoded.error;
  const { envelope } = decoded;
  const data = edit(envelope.sections[CREATURES_SECTION_ID]?.data);
  return encodeSave({
    ...envelope,
    sections: { ...envelope.sections, [CREATURES_SECTION_ID]: { version, data } },
  });
}

describe('creatures in saves (mw-e12.14)', () => {
  it('AC-1: a guard in Searching with 12.5 s left and an LKP keeps its state, its remaining timer and its LKP', () => {
    const start = alarmed();
    const { world, drive } = start;
    const w = sim(world);
    const guard = agent(start, 'guard');
    while (brainOf(w, guard)?.state !== 'searching' && world.tick < 600) run(start, 1);
    const hz = world.clock.hz;
    const left = (at: World<never>): number => {
      const { enteredTick } = brainOf(at, guard) ?? { enteredTick: NaN };
      return (enteredTick + SEARCH_S * hz - at.tick) / hz;
    };
    while (left(w) > 12.5) run(start, 1);
    const before = brainOf(w, guard);
    expect(before?.state).toBe('searching');
    expect(left(w)).toBe(12.5);
    expect(before?.blackboard.lkp).toEqual({ x: 3, y: 0, z: 8 });
    expect(before?.awareness.length).toBeGreaterThan(0); // the stone it heard

    const loaded = reload(world);
    const after = brainOf(sim(loaded), guard);
    expect(after?.state).toBe('searching');
    expect(left(sim(loaded))).toBe(12.5);
    expect(after?.blackboard.lkp).toEqual(before?.blackboard.lkp);
    expect(after).toEqual(before); // the whole brain: awareness, activity, step, timers
    expect(hashWorld(loaded)).toBe(hashWorld(world));

    // It goes on exactly as the unsaved guard does: it searches until its timer runs out, and
    // stands down at its next think.
    for (let i = 0; i < 12.5 * hz - 1; i++) {
      const commands = drive(world.tick);
      world.step(commands);
      loaded.step(commands);
    }
    expect(brainOf(sim(loaded), guard)?.state).toBe('searching');
    for (let i = 0; i < hz; i++) {
      const commands = drive(world.tick);
      world.step(commands);
      loaded.step(commands);
    }
    expect(brainOf(sim(loaded), guard)?.state).toBe('unaware');
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it('AC-3: a v1 save without morale migrates to v2 with morale 100, and the migration test passes', () => {
    expect(CREATURES_SECTION_VERSION).toBe(2);
    const start = hall.start();
    const world = sim(start.world);
    const guard = agent(start, 'guard');
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    // A v1 record: the creatures as they were saved before a condition existed.
    const v1 = rewrite(bytes, 1, (data) => {
      const { creatures } = data as ReturnType<typeof captureCreatures>;
      return {
        creatures: creatures.map(({ entity, components }) => {
          const rest = Object.entries(components).filter(([name]) => name !== 'creature.condition');
          return { entity, components: Object.fromEntries(rest) };
        }),
      };
    });
    const decoded = decodeSave(v1);
    const record = decoded.ok ? decoded.envelope.sections[CREATURES_SECTION_ID] : undefined;
    if (record === undefined) throw new Error('no creatures section');
    const section = creaturesSaveSection();
    const migrated = migrateSection(section, record);
    expect(migrated.ok).toBe(true);
    expect(validateSection(section, migrated.ok ? migrated.data : null).ok).toBe(true);

    const loaded = sim(hall.start().world);
    const result = createGameSaveRegistry().read(loaded, v1);
    expect(result.ok && result.warnings).toEqual([]);
    expect(conditionOf(loaded, guard)).toEqual({ morale: 100, unconsciousUntil: -1 });
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it('AC-4: an unconscious creature stays unconscious after a load with its wake timer, and wakes on time', () => {
    const start = hall.start();
    const world = sim(start.world);
    const sleeper = agent(start, 'sleeper');
    run(start, 30);
    expect(knockOut(world, sleeper, 90)).toBe(true);
    run(start, 600);
    expect(wakeTicksLeft(world, sleeper)).toBe(80 * 60);

    const loaded = sim(reload(start.world));
    expect(isUnconscious(loaded, sleeper)).toBe(true);
    expect(wakeTicksLeft(loaded, sleeper)).toBe(80 * 60);
    expect(conditionOf(loaded, sleeper)).toEqual(conditionOf(world, sleeper));
    for (let i = 0; i < 80 * 60 - 1; i++) loaded.step();
    expect(isUnconscious(loaded, sleeper)).toBe(true);
    loaded.step();
    expect(isUnconscious(loaded, sleeper)).toBe(false);
  });

  it('keeps every creature component out of the world section and brings each back exactly', () => {
    const start = alarmed();
    const world = sim(start.world);
    run(start, 600);
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const decoded = decodeSave(bytes);
    if (!decoded.ok) throw decoded.error;
    const { world: saved, creatures } = decoded.envelope.sections as Record<
      string,
      { data: { components: Record<string, unknown> } }
    >;
    for (const name of [
      CreatureComponent.name,
      CreatureConditionComponent.name,
      BrainComponent.name,
      PerceptionAgentComponent.name,
    ]) {
      expect(saved?.data.components).not.toHaveProperty(name);
    }
    expect(creatures?.data).toEqual(captureCreatures(world));
    const loaded = sim(reload(start.world));
    expect(captureCreatures(loaded)).toEqual(captureCreatures(world));
  });

  it('a save from before the section had creatures in the world section: they load with a fresh condition', () => {
    const start = hall.start();
    const world = sim(start.world);
    const guard = agent(start, 'guard');
    run(start, 1);
    const before = createGameSaveRegistry().write(world, saveOptions);
    // Rebuild the save as a v4 world section holding the creature rows (no condition), no section.
    const decoded = decodeSave(before);
    if (!decoded.ok) throw decoded.error;
    const sections = { ...decoded.envelope.sections };
    const worldData = sections['world']?.data as { components: Record<string, unknown> };
    const components = { ...worldData.components };
    for (const { entity, components: parts } of captureCreatures(world).creatures) {
      for (const [name, value] of Object.entries(parts)) {
        if (name === CreatureConditionComponent.name) continue;
        const rows = (components[name] ?? []) as [number, unknown][];
        components[name] = [...rows, [entity, value]];
      }
    }
    sections['world'] = { version: 4, data: { ...worldData, components } };
    const old = encodeSave({
      ...decoded.envelope,
      sections: Object.fromEntries(
        Object.entries(sections).filter(([id]) => id !== CREATURES_SECTION_ID),
      ),
    });

    const loaded = sim(hall.start().world);
    const result = createGameSaveRegistry().read(loaded, old);
    expect(result.ok && result.warnings).toEqual([]);
    expect(conditionOf(loaded, guard)).toEqual({ morale: 100, unconsciousUntil: -1 });
    expect(brainOf(loaded, guard)).toEqual(brainOf(world, guard));
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it('registers the components a loading world lacks', () => {
    const data = captureCreatures(sim(hall.start().world));
    const bare = new World<never>({ seed: 1 });
    const last = Math.max(...data.creatures.map((c) => c.entity));
    for (let i = 0; i < last; i++) bare.spawn();
    creaturesSaveSection().deserialize(bare, data, {
      warn: () => undefined,
      worldFacts: undefined,
    });
    expect(captureCreatures(bare)).toEqual(data);
  });

  it('rejects a damaged condition and an unknown component by schema', () => {
    const section = creaturesSaveSection();
    const bad = (components: Record<string, unknown>) =>
      validateSection(section, { creatures: [{ entity: 1, components }] }).ok;
    expect(bad({ 'creature.condition': { morale: 100, unconsciousUntil: -1 } })).toBe(true);
    expect(bad({ 'creature.condition': { morale: 101, unconsciousUntil: -1 } })).toBe(false);
    expect(bad({ 'creature.condition': { morale: 50, unconsciousUntil: 1.5 } })).toBe(false);
    expect(bad({ 'ai.brain': { anything: ['goes', 1] } })).toBe(true);
    expect(bad({ 'creature.mood': 1 })).toBe(false);
  });

  it('the v1 → v2 step adds a condition only to creatures without one and passes other data through', () => {
    expect(CREATURES_MIGRATIONS[1]).toBe(addCreatureConditions);
    const fresh = { morale: 100, unconsciousUntil: -1 };
    const out = { morale: 20, unconsciousUntil: 9 };
    expect(
      addCreatureConditions({
        creatures: [
          { entity: 1, components: { 'creature.creature': {} } },
          { entity: 2, components: { 'creature.creature': {}, 'creature.condition': out } },
          { entity: 3, components: { 'ai.brain': {} } },
          { entity: 4 },
          'junk',
        ],
      }),
    ).toEqual({
      creatures: [
        { entity: 1, components: { 'creature.creature': {}, 'creature.condition': fresh } },
        { entity: 2, components: { 'creature.creature': {}, 'creature.condition': out } },
        { entity: 3, components: { 'ai.brain': {} } },
        { entity: 4 },
        'junk',
      ],
    });
    expect(addCreatureConditions(null)).toBeNull();
    expect(addCreatureConditions({ creatures: 3 })).toEqual({ creatures: 3 });
  });
});
