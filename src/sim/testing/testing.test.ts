// The AI scenario harness (mw-e11.3): layout and script validation, the DSL, the headless run and its
// report, hash recording, and the stand-in senses. Content is written tersely here (sim tests may not
// load content); the fixture guard's own content runs in tests/integration/ai-scenarios.test.ts.

import type {
  BehaviourDef,
  ControllerTuning,
  CreatureTable,
  Frozen,
  RuntimeCreature,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { compileBehaviours } from '../ai/behaviour';
import { brainOf, installAi } from '../ai/runtime';
import { CharacterController } from '../character/system';
import { World } from '../core/world';
import { installFactions } from '../factions/runtime';
import { buildFactionTable, UNALIGNED_FACTION } from '../factions/table';
import { LightField } from '../light/field';
import { noiseEmitted } from '../noise/events';
import { registerCreatureComponents, spawnCreature } from '../creatures/spawn';
import { aiScenario, ScenarioFailedError, type ScenarioDeps, type ScenarioSpec } from './scenario';
import { ScenarioLoadError, type ScenarioLayoutInput } from './layout';
import { standInSenses, type ScenarioSenses, type SensedStimulus } from './senses';

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

const SIGHT = {
  nearRange: 8,
  farRange: 20,
  primaryHalfAngle: 35,
  peripheralHalfAngle: 80,
  verticalHalfAngle: 40,
  darkVision: 0,
  detectionSpeed: 1,
};
const HEARING = { thresholdDb: 30, range: 25 };

/** A grey-box creature as compileCreatures would give it (only the fields spawning reads). */
function creature(id: string, senses: object, profile = 'watch'): RuntimeCreature {
  const def = {
    id,
    stats: { health: 60, poise: 20, mass: 70, size: 'medium' },
    attacks: [],
    resistances: {},
    poiseRegen: { delayTicks: 120, percentPerSecond: 25 },
    reactions: { knockbackImpulse: 300, knockdownImpulse: 900, launchSpeed: 2, replace: {} },
    disposition: {},
    behaviour: { profile, tuning: {} },
    needs: {},
    personality: { curiosity: 0.5 },
  } as unknown as RuntimeCreature['def'];
  return Object.freeze({
    id,
    def,
    senses: Object.freeze(senses),
    nav: Object.freeze({ mask: 1, radius: 0.4, height: 1.8 }) as unknown as RuntimeCreature['nav'],
    gaits: Object.freeze({ sneak: 1, walk: 1.5, run: 4 }),
  });
}

const creatures: CreatureTable = new Map(
  [
    creature('watcher', { sight: SIGHT, hearing: HEARING }),
    creature('deaf', { sight: SIGHT }),
    creature('blind', { hearing: HEARING }),
    creature('statue', {}, 'no-such-behaviour'),
  ].map((c) => [c.id, c]),
);

const factions = buildFactionTable([
  {
    id: UNALIGNED_FACTION,
    towardPlayer: 'hostile',
    towardMembers: 'neutral',
    towardOthers: 'neutral',
    relations: [],
  },
  {
    id: 'watch',
    towardPlayer: 'hostile',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
]);

const condition = (input: string, gte: number) => ({ input, gte });
const idle = { steps: [{ do: 'wait', seconds: 100 }] };

/** The awareness ladder with nothing to do on any rung (defaults filled, as content loads it). */
const WATCH = {
  id: 'watch',
  schemaVersion: 1,
  tuning: {},
  thinkHz: 10,
  inertia: 0.1,
  initial: 'unaware',
  states: {
    unaware: {
      transitions: [{ to: 'suspicious', when: condition('awareness', 0.3) }],
      activities: ['idle'],
    },
    suspicious: {
      transitions: [
        { to: 'combat', when: condition('targetVisible', 1) },
        { to: 'investigating', when: condition('awareness', 0.6) },
      ],
      activities: ['idle'],
    },
    investigating: {
      transitions: [{ to: 'combat', when: condition('targetVisible', 1) }],
      activities: ['idle'],
    },
    combat: { transitions: [], activities: ['idle'] },
  },
  activities: {
    idle: { weight: 1, interruptible: true, retryAfterS: 2, considerations: [], ...idle },
  },
} as unknown as Frozen<BehaviourDef>;

const deps: ScenarioDeps = {
  creatures,
  factions,
  behaviours: compileBehaviours([WATCH]),
  controller: TUNING,
};

/** A lit room: the watcher at the origin facing +z, the player behind it, out of its view. */
function room(extra: Partial<ScenarioLayoutInput> = {}): ScenarioLayoutInput {
  return {
    id: 'room',
    light: { ambient: 1 },
    player: { at: [0, 0, -5] },
    fixtures: [{ id: 'w', creature: 'watcher', at: [0, 0, 0] }],
    ...extra,
  };
}

function spec(extra: Partial<ScenarioSpec> = {}): ScenarioSpec {
  return { name: 'test', layout: room(), duration: 6, ...extra };
}

const loadIssues = (build: () => unknown): readonly string[] => {
  try {
    build();
  } catch (error) {
    if (error instanceof ScenarioLoadError) return error.issues;
    throw error;
  }
  throw new Error('expected a ScenarioLoadError');
};

describe('scenario layouts and scripts', () => {
  it('AC-4: a layout naming an unknown creature fails as the scenario loads, before any tick', () => {
    const layout = room({
      fixtures: [
        { id: 'w', creature: 'watcher', at: [0, 0, 0] },
        { id: 'ghost', creature: 'fixture-gaurd', at: [2, 0, 0] },
        { id: 'traitor', creature: 'watcher', at: [4, 0, 0], faction: 'nobody' },
      ],
    });
    expect(() => aiScenario(spec({ name: 'typo', layout }), deps)).toThrow(
      new ScenarioLoadError('typo', [
        'layout.fixtures[1] "ghost": unknown creature "fixture-gaurd"',
        'layout.fixtures[2] "traitor": creature "watcher": unknown faction "nobody"',
      ]),
    );
    expect(() => aiScenario(spec({ name: 'typo', layout }), deps)).toThrow(
      /^scenario "typo" cannot load:\n {2}layout\.fixtures\[1\] "ghost": unknown creature/,
    );
  });

  it('lists every problem of a malformed layout with its path', () => {
    const layout = {
      id: '',
      walls: [{ min: [0, 0, 0], max: [1, 0, 1] }],
      light: {
        lights: [
          { id: 'a', at: [0, 1, 0], intensity: 1, radius: 1 },
          { id: 'a', at: [0, 1, 0], intensity: 1, radius: 1 },
        ],
      },
      player: { at: [0, 0], yaw: 45 },
      fixtures: [
        { id: 'x', creature: 'watcher', at: [0, 0, 0] },
        { id: 'x', creature: 'watcher', at: [1, 0, 0] },
      ],
    };
    expect(loadIssues(() => aiScenario(spec({ layout }), deps))).toEqual([
      'layout.id: Too small: expected string to have >=1 characters',
      'layout.walls[0]: every max must exceed its min',
      'layout.light.lights[1].id: duplicate light "a"',
      'layout.player.at: Too small: expected array to have >=3 items',
      expect.stringMatching(/^layout\.player\.yaw: /) as string,
      'layout.fixtures[1].id: duplicate fixture "x"',
    ]);
  });

  it('lists every problem of a malformed player script, and lights it cannot put out', () => {
    expect(
      loadIssues(() =>
        aiScenario(spec({ player: [{ wait: -1 }, { to: [1, 2], speed: 2 }] }), deps),
      ),
    ).toHaveLength(2);
    expect(loadIssues(() => aiScenario(spec({ player: [{ extinguish: 'sun' }] }), deps))).toEqual([
      'player[0].extinguish: the layout has no light "sun"',
    ]);
    expect(loadIssues(() => aiScenario(spec({ duration: 0 }), deps))).toEqual([
      'duration must be > 0 s, got 0',
    ]);
  });

  it('refuses expectations outside the run, backwards windows and unknown fixtures', () => {
    const s = aiScenario(spec(), deps);
    expect(() => s.at(7)).toThrow('scenario "test": time 7 s is outside 0–6 s');
    expect(() => s.at(-1)).toThrow(RangeError);
    expect(() => s.during(3, 2)).toThrow('during(3, 2): from is after to');
    expect(() => s.at(1).expect('guard9')).toThrow(
      'scenario "test" has no fixture "guard9" (it has: w)',
    );
  });
});

describe('running a scenario', () => {
  it('AC-1: a state expected at 3.0 s fails when the agent is still Unaware, and the output lists every transition with times', () => {
    // Behind the watcher, the player is never seen; a stone thrown in front of it at 4 s starts the
    // ladder only after the moment the scenario asserts.
    const s = aiScenario(spec({ player: [{ wait: 4 }, { throw: [0, 0, 5], db: 70 }] }), deps);
    s.at(3.0).expect('w').state('Suspicious');
    const result = s.run();
    expect(result.passed).toBe(false);
    expect(result.expectations).toEqual([
      {
        label: 'at 3.00 s: w is suspicious',
        passed: false,
        detail: 'was unaware at 3.00 s',
      },
    ]);
    const changes = result.timeline.filter((entry) => entry.kind === 'state');
    expect(changes.map((c) => [c.from, c.to, c.cause])).toEqual([
      ['unaware', 'suspicious', 'input:awareness'],
      ['suspicious', 'investigating', 'input:awareness'],
    ]);
    for (const change of changes) {
      expect(result.report).toContain(
        `${change.time.toFixed(3)} s  w       ${change.from} → ${change.to} (input:awareness)`,
      );
    }
    expect(result.report.split('\n').slice(0, 3)).toEqual([
      'scenario "test": 1 of 1 expectations failed',
      '  FAIL  at 3.00 s: w is suspicious: was unaware at 3.00 s',
      'timeline:',
    ]);
    expect(result.report).toContain('hears a noise at (0.00, 0.00, 5.00), 55.6 dB');
    expect(result.report).toContain('player  throw to (0.00, 0.00, 5.00), 70 dB');
    expect(() => s.check()).toThrow(ScenarioFailedError);
    expect(() => s.check()).toThrow(result.report);
  });

  it('AC-2: run twice, a scenario records the same state hash sequence; a golden sequence is checked', () => {
    const script = [
      { to: [6, 4] },
      { wait: 0.5, stance: 'crouch' },
      { to: [-3, 4, 6], stance: 'sprint' },
    ];
    const first = aiScenario(spec({ player: script }), deps).run();
    const second = aiScenario(spec({ player: script }), deps).run();
    expect(first.hashes).toHaveLength(7); // ticks 0, 60 … 360
    expect(second.hashes).toEqual(first.hashes);
    expect(new Set(first.hashes).size).toBe(7);
    expect(first.replay.checkpoints.map((c) => c.tick)).toEqual([0, 60, 120, 180, 240, 300, 360]);

    const golden = (hashes: readonly string[]) =>
      aiScenario(spec({ player: script, golden: hashes }), deps).run().expectations;
    expect(golden(first.hashes)).toEqual([
      { label: 'state hashes match the recording', passed: true, detail: '' },
    ]);
    const changed = first.hashes.map((hash, i) => (i === 3 ? 'deadbeef' : hash));
    expect(golden(changed)[0]?.detail).toBe(
      `at 3.00 s the state hash is ${String(first.hashes[3])}, the recording has deadbeef`,
    );
    expect(golden(first.hashes.slice(0, 5))[0]?.detail).toMatch(
      /^at 5\.00 s the state hash is \w+, the recording has nothing$/,
    );
    expect(golden([...first.hashes, 'more'])[0]?.detail).toBe(
      'the recording has 8 hashes, the run 7',
    );
    // A different seed and tick rate are another run, and hashes follow the chosen interval.
    const other = aiScenario(spec({ player: script, seed: 9, hz: 30, hashEvery: 30 }), deps).run();
    expect(other.replay.stepHz).toBe(30);
    expect(other.hashes).toHaveLength(7);
  });

  it('expects states, activities and positions at moments and over windows', () => {
    // The player walks around the watcher into its view (standing, lit), so it climbs the ladder.
    const s = aiScenario(
      spec({
        layout: room({
          fixtures: [
            { id: 'w', creature: 'watcher', at: [0, 0, 0], faction: 'watch', patrol: [[0, 0, 0]] },
            { id: 'stone', creature: 'statue', at: [9, 0, 9] },
          ],
        }),
        player: [{ to: [-6, -5] }, { to: [-6, 4] }],
        duration: 5,
      }),
      deps,
    );
    s.during(0, 1).expect('w').state('unaware');
    s.during(0, 3).expect('w').notState('investigating');
    s.during(0, 5).expect('w').enters('suspicious', 'unaware');
    s.during(0, 5).expect('w').enters('combat');
    s.at(0).expect('w').doing(null);
    s.at(1).expect('w').doing('idle');
    s.at(5).expect('w').near([0, 0, 0], 0.1);
    s.at(5).expect('w').near([3, 9, 4], 1);
    s.at(5).expect('w').doing('patrol');
    s.during(0, 5).expect('w').enters('investigating', 'unaware');
    s.at(2).expect('stone').state('unaware');
    s.during(0, 5).expect('w').notState('Combat');
    const result = s.run();
    expect(result.expectations.map((e) => [e.passed, e.detail])).toEqual([
      [true, ''],
      [true, ''],
      [true, ''],
      [true, ''],
      [true, ''],
      [true, ''],
      [true, ''],
      [false, 'was 5.00 m away at 5.00 s'],
      [false, 'was doing idle at 5.00 s'],
      [false, 'it did not'],
      [false, 'it has no brain at 2.00 s'],
      [false, 'was combat at 4.57 s'],
    ]);
    expect(result.expectations.map((e) => e.label).slice(2, 8)).toEqual([
      'during 0.00 s–5.00 s: w enters suspicious from unaware',
      'during 0.00 s–5.00 s: w enters combat',
      'at 0.00 s: w is doing null',
      'at 1.00 s: w is doing idle',
      'at 5.00 s: w is within 0.1 m of (0, 0)',
      'at 5.00 s: w is within 1 m of (3, 4)',
    ]);
    const sight = result.timeline.filter((entry) => entry.kind === 'sight');
    expect(sight.map((entry) => entry.seen)).toEqual([true]);
    expect(result.report).toMatch(/w {7}sees the player \(light 1\.00, \d+\.\d m\)/);
    expect(result.report).toContain('player  walk to (-6.00, 4.00)');
  });

  it('a passing run reports so, and check() returns it', () => {
    const s = aiScenario(spec(), deps);
    s.during(0, 6).expect('w').state('Unaware');
    const result = s.check();
    expect(result.passed).toBe(true);
    expect(result.report).toBe(
      'scenario "test": passed\n  pass  during 0.00 s–6.00 s: w is unaware\ntimeline:',
    );
  });

  it('walls hide the player, and so does putting the light out', () => {
    const wall: { min: [number, number, number]; max: [number, number, number] } = {
      min: [-3, 0, 2],
      max: [3, 3, 2.5],
    };
    const behind = aiScenario(
      spec({
        layout: room({ walls: [wall], player: { at: [-2, 0, 5], yaw: 180 } }),
        player: [{ to: [2, 5] }],
        duration: 2,
      }),
      deps,
    ).run();
    expect(behind.timeline.filter((e) => e.kind !== 'player')).toEqual([]);

    // A torch lights the room's far half; it goes out while the player is in it, so the watcher
    // loses sight of the player before its awareness reaches Suspicious.
    const dark = aiScenario(
      spec({
        layout: room({
          light: {
            ambient: 0,
            lights: [{ id: 'torch', at: [0, 2, 10], intensity: 100, radius: 6 }],
          },
          player: { at: [-4, 0, 10], yaw: 90 },
        }),
        player: [{ wait: 0.2 }, { extinguish: 'torch' }, { to: [4, 10], stance: 'crouch' }],
        duration: 3,
      }),
      deps,
    );
    dark.during(0, 3).expect('w').state('unaware');
    const result = dark.run();
    expect(result.passed).toBe(true);
    expect(result.timeline.map((e) => (e.kind === 'sight' ? e.seen : e.kind))).toEqual([
      'player',
      true,
      'player',
      'player',
      false,
    ]);
  });
});

describe('stand-in senses', () => {
  it('see within far range and the vertical half-angle, by the light of ambient zones', () => {
    // The room is dark but for a lit zone around the player, who stands in front of all three.
    const result = aiScenario(
      spec({
        layout: room({
          light: { ambient: 0, zones: [{ id: 'lamp', min: [-2, 0, 3], max: [2, 3, 7], level: 1 }] },
          player: { at: [0, 0, 5] },
          fixtures: [
            { id: 'w', creature: 'watcher', at: [0, 0, 0] },
            { id: 'far', creature: 'watcher', at: [0, 0, -25] },
            { id: 'pit', creature: 'watcher', at: [0, -8, 7], yaw: 180 },
          ],
        }),
        duration: 1,
      }),
      deps,
    ).run();
    const sight = result.timeline.filter((e) => e.kind === 'sight');
    expect(sight.map((e) => [e.agent, e.light])).toEqual([['w', 1]]);
  });

  /** A world with AI and the given creatures at the origin facing +z, sensed by `senses`. */
  function sensed(
    kinds: readonly string[],
    player: number,
    senses: ScenarioSenses = standInSenses,
  ) {
    const world = installFactions(registerCreatureComponents(new World<never>({ seed: 1 })));
    world.register(CharacterController);
    installAi(world, { behaviours: deps.behaviours });
    const notes: SensedStimulus[] = [];
    world.addSystem(senses(world, { player, light: new LightField(), note: (s) => notes.push(s) }));
    const agents = kinds.map((kind, i) => {
      const result = spawnCreature(
        world,
        { creatures, factions },
        {
          creature: kind,
          at: { x: 2 * i, y: i === 0 ? -6 : 0, z: 0 },
        },
      );
      if (!result.ok) throw new Error(result.error.kind);
      return result.entity;
    });
    return { world, agents, notes };
  }

  it('hear noises above their threshold within range, and see nothing without a player body', () => {
    const { world, agents, notes } = sensed(['watcher', 'deaf', 'blind'], 999);
    const noise = (x: number, loudness: number) => {
      world.events.emit(noiseEmitted, {
        tick: world.tick,
        position: { x, y: 0, z: 0 },
        loudness,
        kind: 'test',
        entity: null,
        source: null,
      });
      world.step();
    };
    noise(40, 120); // beyond hearing range
    noise(4, 20); // below threshold everywhere
    expect(notes).toEqual([]);
    noise(4, 70);
    expect(notes.map((n) => [n.kind, n.agent])).toEqual([
      ['hearing', agents[0]],
      ['hearing', agents[2]],
    ]);
    expect(brainOf(world, agents[2] ?? -1)?.blackboard).toMatchObject({
      stimulus: { x: 4, y: 0, z: 0 },
    });
    expect(brainOf(world, agents[1] ?? -1)?.blackboard.awareness).toBe(0);
  });

  it('can be replaced by a scenario’s own senses', () => {
    const seen: number[] = [];
    const custom: ScenarioSenses = () => ({ name: 'custom', run: ({ tick }) => seen.push(tick) });
    aiScenario(spec({ duration: 0.05 }), { ...deps, senses: custom }).run();
    expect(seen).toEqual([0, 1, 2]);
    expect(sensed(['watcher'], 1, custom).notes).toEqual([]);
  });
});
