// mw-e12.14 AC-2: resume determinism. The AI scenario harness's guard hall on the frozen fixture
// guard (real perception, awareness, alert machine, noise propagation and the player's controller)
// runs a recorded 600-tick replay: the guard sees the player, fights, loses it and hears two thrown
// stones. A run saved at tick 300 through the game's save registry, loaded into a fresh world and
// replayed on to tick 600 ends on the same state hash as the uninterrupted run — and so does a save
// at every other tick, including those with noises heard but not yet perceived.
import { describe, expect, it } from 'vitest';
import { compileCreatures, controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  aiScenario,
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  hashWorld,
  type ScenarioDeps,
  type World,
} from '@sim/index';
import guardHall from './fixtures/ai-scenarios/guard-hall.json';

const content = loadFixtureContent();
const deps: ScenarioDeps = {
  creatures: compileCreatures(content.all('creature'), content),
  factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
  behaviours: compileBehaviours(content.all('behaviour')),
  controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
};
const saveOptions = {
  build: { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' },
  wallClockSavedAt: 1_790_000_000_000,
};

const TICKS = 600;

const scenario = aiScenario(
  {
    name: 'guard-hall-resume',
    layout: guardHall,
    player: [
      { wait: 0.5 },
      { to: [11, 6] },
      { throw: [0, 0, 6], db: 70 },
      { wait: 1 },
      { throw: [-3, 0, 2], db: 60 },
      { to: [-11, 6] },
    ],
    duration: TICKS / 60,
  },
  deps,
);

/** The recorded replay's commands, one list per tick. */
function recordedCommands(): (readonly unknown[])[] {
  const { replay, timeline } = scenario.run();
  // The replay exercises what a save has to carry: alert states, sight, and noises heard.
  expect(timeline.some((e) => e.kind === 'state' && e.to === 'combat')).toBe(true);
  expect(timeline.filter((e) => e.kind === 'hearing')).toHaveLength(2);
  return replay.inputs.flatMap(([count, commands]) =>
    Array.from({ length: count }, () => commands),
  );
}

/** Saves `world` through the game's registry and loads it into a fresh start of the scenario. */
function reload(world: World): World {
  const registry = createGameSaveRegistry();
  const loaded = scenario.start().world;
  const result = registry.read(loaded, registry.write(world, saveOptions));
  if (!result.ok) throw result.error;
  expect(result.warnings).toEqual([]);
  return loaded;
}

function replay(world: World, commands: readonly (readonly unknown[])[], to: number): void {
  while (world.tick < to) world.step(commands[world.tick] ?? []);
}

describe('creature state resumes deterministically (mw-e12.14)', () => {
  it('AC-2: a 600-tick replay saved and loaded at tick 300 ends on the uninterrupted run’s hash', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const commands = recordedCommands();
    expect(commands).toHaveLength(TICKS);

    const uninterrupted = scenario.start().world;
    replay(uninterrupted, commands, TICKS);

    const saved = scenario.start().world;
    replay(saved, commands, 300);
    const loaded = reload(saved);
    expect(loaded.tick).toBe(300);
    expect(hashWorld(loaded)).toBe(hashWorld(saved));
    replay(loaded, commands, TICKS);
    expect(hashWorld(loaded)).toBe(hashWorld(uninterrupted));
  });

  it('a save at any tick of the replay resumes to the same final hash', () => {
    const commands = recordedCommands();
    const uninterrupted = scenario.start().world;
    replay(uninterrupted, commands, TICKS);
    const final = hashWorld(uninterrupted);

    const running = scenario.start().world;
    const diverged: number[] = [];
    for (let tick = 0; tick < TICKS; tick += 1) {
      const loaded = reload(running);
      replay(loaded, commands, TICKS);
      if (hashWorld(loaded) !== final) diverged.push(tick);
      running.step(commands[tick] ?? []);
    }
    expect(diverged).toEqual([]);
  }, 60_000);
});
