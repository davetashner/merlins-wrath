// Awareness (mw-e11.6): per-source accumulation from percepts, grace and decay, instant detection on
// touch, dominant-cause tracking, forgetting sources that are gone, and the blackboard it writes.
import type { BehaviourDef, ControllerTuning, Frozen, NavAgent } from '@content/index';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STEALTH_TUNING, initialCharacterState } from '../character/controller';
import { CharacterController, CharacterTuning } from '../character/system';
import { CombatFacingComponent } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CreatureNavComponent, CreatureSensesComponent } from '../creatures/components';
import { registerCreatureComponents } from '../creatures/spawn';
import {
  entitySource,
  perceived,
  percept,
  soundSource,
  type Percept,
  type PerceptSource,
} from '../perception/percept';
import { perceptionSystem, perceptSourcePresent } from '../perception/system';
import { FakeSightWorld } from '../sight/fake-sight-world';
import { LineOfSight } from '../sight/line-of-sight';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  awarenessBand,
  awarenessOf,
  contribution,
  DEFAULT_AWARENESS_TUNING,
  installAwareness,
  thinkAwareness,
  topRecord,
  traitModifier,
  type AwarenessFactors,
  type AwarenessRecord,
  type AwarenessTuning,
} from './awareness';
import { compileBehaviours } from './behaviour';
import { brainOf, giveBrain, installAi } from './runtime';

const PLAYER = entitySource(1);
const ROCK = soundSource('throw');
const HERE: Vec3 = { x: 1, y: 0, z: 2 };
const NEUTRAL: AwarenessFactors = { traits: {}, sightSpeed: 1, difficulty: 1 };

/** A percept of `source` by `sense`. */
function sensed(
  sense: string,
  strength: number,
  source: PerceptSource = PLAYER,
  position: Vec3 = HERE,
): Percept {
  const kind =
    sense === 'sight'
      ? 'seen-target'
      : sense === 'hearing'
        ? 'heard-noise'
        : sense === 'touch'
          ? 'touched'
          : 'sensed-life';
  return percept({ source, kind, sense, position, strength, certainty: 1 });
}

/** Runs thinks of `seconds` each with the same percepts `times` times. */
function run(
  records: AwarenessRecord[],
  percepts: readonly Percept[],
  times: number,
  seconds = 0.1,
  tuning: AwarenessTuning = DEFAULT_AWARENESS_TUNING,
) {
  for (let i = 0; i < times; i++) thinkAwareness(records, percepts, seconds, NEUTRAL, tuning);
}

const level = (records: readonly AwarenessRecord[], source: PerceptSource = PLAYER) =>
  records.find((r) => r.source === source)?.level;

describe('awareness accumulation and decay (mw-e11.6)', () => {
  it('AC-1: a constant sight stimulus of strength 1.0 at rate 1.0/s gives 0.6 after 0.6 s', () => {
    expect(DEFAULT_AWARENESS_TUNING.senses['sight']).toEqual({ perS: 1 });
    const records: AwarenessRecord[] = [];
    run(records, [sensed('sight', 1)], 6); // six thinks of 0.1 s
    expect(level(records)).toBeCloseTo(0.6, 2);
    expect(Math.abs((level(records) ?? 0) - 0.6)).toBeLessThanOrEqual(0.01);
    // It caps at 1.
    run(records, [sensed('sight', 1)], 10);
    expect(level(records)).toBe(1);
  });

  it('AC-2: with no stimuli, awareness 0.5 holds for the 2 s grace, then decays 0.1/s (0.3 at 4 s)', () => {
    expect(DEFAULT_AWARENESS_TUNING).toMatchObject({ graceS: 2, decayPerS: 0.1 });
    const records: AwarenessRecord[] = [];
    run(records, [sensed('sight', 1)], 1, 0.5); // 0.5 at t = 0
    expect(level(records)).toBe(0.5);
    run(records, [], 20); // t = 2 s
    expect(level(records)).toBeCloseTo(0.5, 9);
    run(records, [], 20); // t = 4 s
    expect(level(records)).toBeCloseTo(0.3, 9);
    // A think straddling the end of the grace decays only for the part after it.
    const straddle: AwarenessRecord[] = [];
    run(straddle, [sensed('sight', 1)], 1, 0.5);
    run(straddle, [], 1, 1.5);
    run(straddle, [], 1, 1);
    expect(level(straddle)).toBeCloseTo(0.45, 9);
    // At 0 the record is gone.
    run(records, [], 40);
    expect(records).toEqual([]);
  });

  it('AC-3: a touch sets awareness to 1.0 at once', () => {
    const records: AwarenessRecord[] = [];
    run(records, [sensed('sight', 0.05)], 1);
    const think = thinkAwareness(records, [sensed('touch', 1)], 0.1, NEUTRAL);
    expect(level(records)).toBe(1);
    expect(think.stimulated).toEqual([PLAYER]);
    expect(records[0]?.cause).toMatchObject({ kind: 'touched', sense: 'touch' });
    expect(records[0]?.cause.amount).toBeCloseTo(1 - 0.005, 9);
  });

  it('AC-4: sight and hearing in one think: the dominant cause is the larger contribution', () => {
    const records: AwarenessRecord[] = [];
    // Sight 0.3 × 1/s × 0.1 s = 0.03; hearing 0.4 × 1 per percept = 0.4.
    thinkAwareness(records, [sensed('sight', 0.3), sensed('hearing', 0.4)], 0.1, NEUTRAL);
    expect(records[0]?.cause).toMatchObject({ kind: 'heard-noise', sense: 'hearing' });
    expect(records[0]?.cause.amount).toBeCloseTo(0.4, 9);
    expect(level(records)).toBeCloseTo(0.43, 9);
    // A long, strong look outweighs a faint sound.
    thinkAwareness(
      records,
      [sensed('sight', 1, PLAYER, { x: 3, y: 0, z: 3 }), sensed('hearing', 0.1)],
      0.5,
      NEUTRAL,
    );
    expect(records[0]?.cause).toEqual({
      kind: 'seen-target',
      sense: 'sight',
      position: { x: 3, y: 0, z: 3 },
      amount: 0.5,
    });
    // On a tie the earlier percept (sight comes first) is the cause.
    const tie: AwarenessRecord[] = [];
    thinkAwareness(tie, [sensed('sight', 0.5), sensed('hearing', 0.05)], 0.1, NEUTRAL);
    expect(tie[0]?.cause.sense).toBe('sight');
  });

  it('AC-5: a source that despawns has its record removed on the next think, without error', () => {
    const records: AwarenessRecord[] = [];
    run(records, [sensed('sight', 1), sensed('hearing', 0.5, ROCK)], 3);
    expect(records.map((r) => r.source)).toEqual([PLAYER, ROCK]);
    const gone = new Set([PLAYER]);
    const think = thinkAwareness(records, [], 0.1, NEUTRAL, DEFAULT_AWARENESS_TUNING, (s) => {
      return !gone.has(s);
    });
    expect(think.removed).toEqual([PLAYER]);
    expect(records.map((r) => r.source)).toEqual([ROCK]);

    // In a world: a target entity destroyed between thinks.
    const world = new World<never>({ seed: 1 });
    const thing = world.spawn();
    const present = (s: PerceptSource) => perceptSourcePresent(world, s);
    const own: AwarenessRecord[] = [];
    thinkAwareness(
      own,
      [sensed('sight', 1, entitySource(thing))],
      0.1,
      NEUTRAL,
      undefined,
      present,
    );
    world.destroy(thing);
    expect(() =>
      thinkAwareness(own, [], 0.1, NEUTRAL, DEFAULT_AWARENESS_TUNING, present),
    ).not.toThrow();
    expect(own).toEqual([]);
    expect(present(soundSource('break'))).toBe(true);
  });

  it('keeps one record per source, sorted by source, each with its own grace', () => {
    const records: AwarenessRecord[] = [];
    const b = entitySource(2);
    thinkAwareness(records, [sensed('sight', 1, b), sensed('sight', 0.5)], 0.2, NEUTRAL);
    expect(records.map((r) => [r.source, r.level])).toEqual([
      [PLAYER, 0.1],
      [b, 0.2],
    ]);
    run(records, [sensed('sight', 1, b)], 25);
    expect(level(records, b)).toBe(1);
    expect(level(records)).toBeLessThan(0.1); // quiet for 2.5 s
    expect(records.find((r) => r.source === PLAYER)?.quietS).toBeCloseTo(2.5, 9);
    expect(topRecord(records)?.source).toBe(b);
    expect(topRecord([])).toBeUndefined();
    // On a tie the first by source is the top.
    const cause = { kind: 'seen-target', sense: 'sight', position: HERE, amount: 0.4 } as const;
    expect(
      topRecord([
        { source: PLAYER, level: 0.4, quietS: 0, cause },
        { source: b, level: 0.4, quietS: 0, cause },
      ])?.source,
    ).toBe(PLAYER);
    // A percept of strength 0 still counts as a stimulus (it resets the grace) but adds nothing.
    const faint: AwarenessRecord[] = [];
    thinkAwareness(faint, [sensed('sight', 0)], 0.1, NEUTRAL);
    expect(faint).toMatchObject([{ level: 0, quietS: 0 }]);
    thinkAwareness(faint, [], 0.1, NEUTRAL);
    expect(faint).toEqual([]);
  });

  it('scales contributions by sense rate, sight detection speed, traits and difficulty', () => {
    const p = sensed('sight', 0.5);
    expect(contribution(p, 0.2, NEUTRAL)).toBeCloseTo(0.1, 9);
    expect(contribution(p, 0.2, { ...NEUTRAL, sightSpeed: 2 })).toBeCloseTo(0.2, 9);
    expect(contribution(p, 0.2, { ...NEUTRAL, difficulty: 0.5 })).toBeCloseTo(0.05, 9);
    // Sight speed scales only sight; hearing is per percept, whatever the seconds.
    const heard = sensed('hearing', 0.5);
    expect(contribution(heard, 0.2, { ...NEUTRAL, sightSpeed: 2 })).toBe(0.5);
    expect(contribution(heard, 5, NEUTRAL)).toBe(0.5);
    // A sense the table does not list builds at the tuning's other rate.
    expect(contribution(sensed('life-sense', 1), 1, NEUTRAL)).toBe(0.5);
    // Diligence ±0.25 at its extremes, 1 at 0.5 or missing.
    expect(traitModifier({})).toBe(1);
    expect(traitModifier({ diligence: 1 })).toBe(1.25);
    expect(traitModifier({ diligence: 0, curiosity: 1 })).toBe(0.75);
    expect(contribution(p, 0.2, { ...NEUTRAL, traits: { diligence: 1 } })).toBeCloseTo(0.125, 9);
    const custom: AwarenessTuning = {
      ...DEFAULT_AWARENESS_TUNING,
      traits: { curiosity: 1 },
      instant: [],
    };
    expect(traitModifier({ curiosity: 0.75 }, custom)).toBe(1.5);
    // Without an instant sense, a touch is an ordinary sense.
    const records: AwarenessRecord[] = [];
    run(records, [sensed('touch', 1)], 1, 0.1, custom);
    expect(level(records)).toBeCloseTo(0.05, 9);
  });

  it('bands a level by the thresholds', () => {
    expect(DEFAULT_AWARENESS_TUNING.thresholds).toEqual({
      suspicious: 0.3,
      investigating: 0.6,
      detected: 1,
    });
    expect([0, 0.29, 0.3, 0.59, 0.6, 0.99, 1].map((n) => awarenessBand(n))).toEqual([
      'unaware',
      'unaware',
      'suspicious',
      'suspicious',
      'investigating',
      'investigating',
      'detected',
    ]);
    expect(awarenessBand(0.5, { suspicious: 0.1, investigating: 0.2, detected: 0.5 })).toBe(
      'detected',
    );
  });
});

const IDLE = {
  id: 'idle',
  schemaVersion: 1,
  tuning: {},
  thinkHz: 10,
  inertia: 0.1,
  initial: 'unaware',
  states: {
    unaware: {
      transitions: [],
      activities: ['wait'],
    },
  },
  activities: {
    wait: {
      weight: 1,
      interruptible: true,
      retryAfterS: 2,
      considerations: [],
      steps: [{ do: 'wait', seconds: 100 }],
    },
  },
} as unknown as Frozen<BehaviourDef>;

const CONTROLLER: Frozen<ControllerTuning> = {
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
  stealth: DEFAULT_STEALTH_TUNING,
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

describe('awareness in a world (mw-e11.6)', () => {
  /** A world with AI and awareness; a guard at the origin facing +z, given a brain. */
  function setup(options: Parameters<typeof installAwareness>[1] = {}, detectionSpeed = 1) {
    const world = registerCreatureComponents(
      new World<never>({ seed: 1, hz: 60, difficulty: { detectionSpeed } }),
    );
    installAi(world, { behaviours: compileBehaviours([IDLE]) });
    const uninstall = installAwareness(world, options);
    const guard = world.spawn();
    giveBrain(world, guard, { behaviour: 'idle' });
    const report = (percepts: readonly Percept[], seconds = 0.1, agent: EntityId = guard) => {
      world.events.emit(perceived, { tick: world.tick, agent, seconds, percepts });
      world.step();
    };
    const board = () => brainOf(world, guard)?.blackboard;
    return { world, guard, report, board, uninstall };
  }

  it('AC-3: the player bumping into an Unaware guard in darkness makes it fully aware at once', () => {
    const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
    world.register(CharacterController, CharacterTuning);
    installAi(world, { behaviours: compileBehaviours([IDLE]) });
    world.addSystem(
      perceptionSystem(world, {
        lineOfSight: new LineOfSight({ world: new FakeSightWorld() }),
        light: { levelAt: () => 0 }, // pitch dark, and the guard has no dark vision
      }),
    );
    const guard = world.spawn();
    world.add(guard, CreatureSensesComponent, { sight: SIGHT });
    world.add(guard, PlacementComponent, { x: 0, y: 0, z: 0, radius: 0.4 });
    world.add(guard, CombatFacingComponent, { facing: { x: 0, y: 0, z: 1 } });
    world.add(guard, CreatureNavComponent, { height: 1.8, radius: 0.4 } as Frozen<NavAgent>);
    giveBrain(world, guard, { behaviour: 'idle' });
    const player = world.spawn();
    world.add(player, CharacterTuning, CONTROLLER);
    world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: -3 }));
    const target = (s: PerceptSource) => (s === entitySource(player) ? player : undefined);
    installAwareness(world, { target });
    for (let i = 0; i < 6; i++) world.step(); // behind it, unseen and untouched
    expect(brainOf(world, guard)?.blackboard.awareness).toBe(0);
    expect(brainOf(world, guard)?.state).toBe('unaware');
    // It walks into the guard's back.
    world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: -0.8 }));
    for (let i = 0; i < 6; i++) world.step();
    expect(brainOf(world, guard)?.blackboard.awareness).toBe(1);
    expect(awarenessOf(world, guard)).toMatchObject([
      { source: entitySource(player), level: 1, cause: { kind: 'touched', sense: 'touch' } },
    ]);
    // Felt, not seen: it knows where, but does not see a target.
    expect(brainOf(world, guard)?.blackboard).toMatchObject({
      stimulus: { x: 0, y: 0, z: -0.8 },
      targetVisible: false,
      target: null,
    });
  });

  it('writes the top level and where its cause was perceived, while it is stimulated', () => {
    const { report, board } = setup();
    report([sensed('hearing', 0.4, ROCK, { x: 5, y: 0, z: 5 })]);
    expect(board()).toMatchObject({ awareness: 0.4, stimulus: { x: 5, y: 0, z: 5 } });
    // A fainter source does not move the stimulus; the top level stays.
    report([sensed('sight', 1, PLAYER, { x: 9, y: 0, z: 9 })]);
    expect(board()).toMatchObject({ awareness: 0.4, stimulus: { x: 5, y: 0, z: 5 } });
    // Nothing perceived: the level holds through the grace, the stimulus is left alone.
    report([]);
    expect(board()?.awareness).toBe(0.4);
  });

  it('reads the agent’s traits, sight speed and the difficulty', () => {
    const { world, guard, report, board } = setup({}, 0.5);
    world.add(guard, CreatureSensesComponent, {
      sight: { ...SIGHT, detectionSpeed: 2 },
    });
    report([sensed('sight', 1)], 0.2);
    expect(board()?.awareness).toBeCloseTo(0.2, 9); // 1 × 0.2 s × 2 × 0.5
  });

  it('makes a seen target the target, visible once Detected, and forgets it when it is gone', () => {
    const present = new Set<PerceptSource>([PLAYER, ROCK]);
    const { report, board, world } = setup({
      present: (s) => present.has(s),
      target: (s) => (s === PLAYER ? 7 : undefined),
    });
    report([sensed('hearing', 1, ROCK), sensed('sight', 0.5)], 0.2);
    expect(board()).toMatchObject({ target: 7, targetVisible: false, awareness: 1 });
    for (let i = 0; i < 10; i++) report([sensed('sight', 1)]);
    expect(board()).toMatchObject({ target: 7, targetVisible: true });
    expect(board()?.targetSeenTick).toBe(world.tick - 1);
    // Out of sight: no longer visible, but still its target.
    report([sensed('hearing', 0.1, ROCK)]);
    expect(board()).toMatchObject({ target: 7, targetVisible: false });
    // A source that is not a target going away leaves the target alone…
    present.delete(ROCK);
    report([]);
    expect(board()?.target).toBe(7);
    // …the target's going clears it.
    present.delete(PLAYER);
    report([]);
    expect(board()).toMatchObject({ target: null, targetVisible: false, awareness: 0 });
  });

  it('ignores reports for agents without a brain, and stops when uninstalled', () => {
    const { world, report, board, uninstall } = setup();
    const stranger = world.spawn();
    expect(() => {
      report([sensed('sight', 1)], 0.1, stranger);
    }).not.toThrow();
    expect(awarenessOf(world, stranger)).toEqual([]);
    uninstall();
    report([sensed('sight', 1)]);
    expect(board()?.awareness).toBe(0);
  });
});
