// The scenarios save fixtures are built from (mw-e30.3): every registered replay scenario, plus
// `creature-guards` (mw-e12.14), the AI scenario harness's guard hall on the frozen fixture content,
// so the creatures section has real saves to migrate: one guard searching the spot an alarm named,
// with awareness of a noise, a last-known position and a running activity, and one knocked out at
// its post.

import { compileCreatures, controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  aiScenario,
  buildFactionTable,
  compileBehaviours,
  CreatureComponent,
  factionSpecFromDef,
  knockOut,
  queueAiEvent,
  replayScenarios,
  type ReplayScenario,
  type ScenarioDeps,
  type World,
  writeBlackboard,
} from '@sim/index';
import { z } from 'zod';
import type { ScenarioRegistry } from './fixtures';

/**
 * The guard hall (tests/integration/fixtures/ai-scenarios/guard-hall.json) with a second guard,
 * `sleeper`, standing behind the west wall where neither the player nor the noise reaches it.
 */
const GUARD_HALL = {
  id: 'creature-guards',
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
    { id: 'guard', creature: 'fixture-guard', at: [0, 0, 0], yaw: 0, patrol: [[0, 0, 0]] },
    { id: 'sleeper', creature: 'fixture-guard', at: [-9, 0, -6], yaw: 180, patrol: [[-9, 0, -6]] },
  ],
};

/** The player, far outside, throws a stone into the hall 8 s in, while the guard searches. */
const PLAYER_SCRIPT = [{ wait: 8 }, { throw: [2, 0, 7], db: 65 }];

/** Where the alarm the guard hears as the world starts says the intruder is. */
const ALARM_AT = { x: 3, y: 0, z: 8 };

let deps: ScenarioDeps | undefined;

/** The frozen fixture content the guards run on (loaded once). */
function fixtureDeps(): ScenarioDeps {
  if (deps === undefined) {
    const content = loadFixtureContent();
    deps = {
      creatures: compileCreatures(content.all('creature'), content),
      factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
      behaviours: compileBehaviours(content.all('behaviour')),
      controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
    };
  }
  return deps;
}

/** Each world's player driver: the harness's player script, tick by tick. */
const drivers = new WeakMap<World, (tick: number) => readonly unknown[]>();

/** The guard hall as a replay scenario: the player's script drives it. */
export const creatureGuardsScenario: ReplayScenario<unknown> = {
  name: 'creature-guards',
  usesContent: true,
  command: z.unknown(),
  create({ seed, hz }) {
    const scenario = aiScenario(
      { name: 'creature-guards', layout: GUARD_HALL, player: PLAYER_SCRIPT, duration: 1, seed, hz },
      fixtureDeps(),
    );
    const { world, drive, agents } = scenario.start();
    // An ally raises the alarm about the torchlit spot: the guard hunts there, then searches it.
    for (const [id, entity] of agents) {
      if (id !== 'guard') continue;
      writeBlackboard(world, entity, { lkp: ALARM_AT });
      queueAiEvent(world, entity, 'ally-alarm');
    }
    drivers.set(world, drive);
    return world;
  },
  drive: ({ tick, world }) => drivers.get(world)?.(tick) ?? [],
};

/** Knocks the `sleeper` guard out for two minutes (a fixture's `prepare`). */
export function knockOutSleeper(world: World): void {
  const w = world as World<never>;
  for (const entity of w.query(CreatureComponent).ids()) {
    if (w.get(entity, CreatureComponent)?.origin.point === 'sleeper') knockOut(w, entity, 120);
  }
}

/** Every scenario a save fixture may name. */
export const FIXTURE_SCENARIOS: ScenarioRegistry = Object.freeze({
  ...replayScenarios,
  [creatureGuardsScenario.name]: creatureGuardsScenario,
});
