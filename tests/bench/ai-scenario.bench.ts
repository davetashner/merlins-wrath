// mw-e11.3 AC-5: a 120 s AI scenario with 6 agents runs headless in ≤ 3 s of wall time. Six frozen
// fixture guards walk their own 6 m squares in a 3 × 2 grid under a torch each; the player walks a
// loop through all their views (walking, crouching, sprinting) and throws two stones, so the guards
// keep perceiving, climbing the ladder and moving. The whole scenario run is timed (building the
// world, every tick through the replay recorder, perception and awareness, AI, the player controller, the
// light field, hashing and the expectations), after one warm-up run; the median of three counts.
import { describe, expect, test } from 'vitest';
import { compileCreatures, controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  aiScenario,
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  type ScenarioDeps,
} from '@sim/index';

/** The AC-5 budget, milliseconds of wall time for the whole run. */
const BUDGET_MS = 3000;
const DURATION_S = 120;

const content = loadFixtureContent();
const deps: ScenarioDeps = {
  creatures: compileCreatures(content.all('creature'), content),
  factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
  behaviours: compileBehaviours(content.all('behaviour')),
  controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
};

const cells = [0, 1, 2].flatMap((i) => [0, 1].map((k) => [i * 14, k * 14] as const));

const layout = {
  id: 'six-guards',
  walls: [{ min: [6, 0, -2], max: [7, 3, 4] }],
  light: {
    ambient: 0.15,
    lights: cells.map(([x, z], i) => ({
      id: `torch${String(i)}`,
      at: [x + 3, 2.5, z + 3],
      intensity: 200,
      radius: 10,
    })),
  },
  player: { at: [-8, 0, -8] },
  fixtures: cells.map(([x, z], i) => ({
    id: `guard${String(i)}`,
    creature: 'fixture-guard',
    at: [x, 0, z],
    patrol: [
      [x, 0, z],
      [x + 6, 0, z],
      [x + 6, 0, z + 6],
      [x, 0, z + 6],
    ],
  })),
};

const player = [
  { to: [36, -8] },
  { to: [36, 26], stance: 'crouch' },
  { throw: [20, 0, 10], db: 75 },
  { to: [-8, 26], stance: 'sprint' },
  { wait: 5 },
  { to: [-8, -8] },
  { throw: [6, 0, 20], db: 70 },
  { to: [36, 26] },
  { to: [-8, -8], stance: 'crouch' },
];

function run(): number {
  const scenario = aiScenario({ name: 'six-guards', layout, player, duration: DURATION_S }, deps);
  for (let i = 0; i < cells.length; i++) {
    scenario
      .during(0, DURATION_S)
      .expect(`guard${String(i)}`)
      .notState('searching');
  }
  const start = performance.now();
  const result = scenario.run();
  const elapsed = performance.now() - start;
  // The run is real work: every guard perceives the player and climbs at least one rung.
  expect(result.passed).toBe(true);
  const climbed = new Set(result.timeline.flatMap((e) => (e.kind === 'state' ? [e.agent] : [])));
  expect(climbed.size).toBe(cells.length);
  return elapsed;
}

describe('ai scenario', () => {
  test(`AC-5: a ${String(DURATION_S)} s scenario with 6 agents runs headless in ≤ 3 s`, () => {
    run(); // warm-up
    const times = [run(), run(), run()].sort((a, b) => a - b);
    const median = times[1] ?? Infinity;
    console.log(`ai scenario: ${String(DURATION_S)} s, 6 agents: median ${median.toFixed(0)} ms`);
    expect(median).toBeLessThanOrEqual(BUDGET_MS);
  });
});
