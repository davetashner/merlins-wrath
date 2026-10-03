// Target memory (mw-e11.8): records from percepts and ally reports, observed velocity, the bounded
// prediction, confidence decay and forgetting, persistent anomalies, and how awareness keeps the
// blackboard's target memory in step in a world.
import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { registerCreatureComponents } from '../creatures/spawn';
import { DamageModel } from '../combat/damage/model';
import { DAMAGE_COMPONENTS, giveCombatant } from '../combat/damage/components';
import {
  anomalySource,
  entitySource,
  perceived,
  percept,
  soundSource,
  type Percept,
  type PerceptKind,
  type PerceptSource,
} from '../perception/percept';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installAlertTriggers } from './alert';
import { hearReport, installAwareness, recallTarget } from './awareness';
import { compileBehaviours } from './behaviour';
import {
  applyReport,
  confidenceAt,
  DEFAULT_MEMORY_TUNING,
  forgetStale,
  observePercepts,
  predictedAt,
  recall,
  type MemoryRecord,
  type MemoryTuning,
} from './memory';
import { brainOf, giveBrain, installAi, memoryTuning } from './runtime';

const HZ = 60;
const PLAYER = entitySource(1);
const ROCK = soundSource('throw');
const BODY = anomalySource('body-1');
const P: Vec3 = { x: 10, y: 0, z: 5 };

/** A percept of `source` of `kind` at `position`. */
function seen(
  position: Vec3,
  source: PerceptSource = PLAYER,
  kind: PerceptKind = 'seen-target',
  certainty = 1,
): Percept {
  const sense = kind === 'heard-noise' ? 'hearing' : kind === 'touched' ? 'touch' : 'sight';
  return percept({ source, kind, sense, position, strength: 1, certainty });
}

const east = (from: Vec3, metres: number): Vec3 => ({ x: from.x + metres, y: from.y, z: from.z });

/** The first record (there must be one). */
function first(records: readonly MemoryRecord[]): MemoryRecord {
  const [record] = records;
  if (record === undefined) throw new Error('no memory');
  return record;
}

/** Memory of the player seen at P running 3 m/s east: two sightings 0.1 s apart, the last at tick 6. */
function runningEast(): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  observePercepts(records, [seen(east(P, -0.3))], 0, HZ);
  observePercepts(records, [seen(P)], 6, HZ);
  return records;
}

describe('target memory (mw-e11.8)', () => {
  it('AC-1: last seen at P moving 3 m/s east, after 10 s without stimuli the prediction is P + 4.5 m east and never moves further', () => {
    const records = runningEast();
    const record = first(records);
    expect(record.velocity.x).toBeCloseTo(3, 9);
    expect(record.velocity.z).toBe(0);
    const at = (s: number) => predictedAt(record, 6 + s * HZ, HZ);
    expect(at(0)).toEqual(P);
    expect(at(1).x).toBeCloseTo(13, 9);
    expect(at(1.5).x).toBeCloseTo(14.5, 9); // the cap
    const later = [2, 5, 10].map(at);
    for (const p of later) expect(p).toEqual(at(1.5));
    const recalled = recall(records, PLAYER, 6 + 10 * HZ, HZ);
    expect(recalled?.predicted.x).toBeCloseTo(P.x + 4.5, 9);
    expect(recalled?.predicted.z).toBe(P.z);
    expect(recalled?.lkp).toEqual(P);
  });

  it('AC-2: the player, unseen, moves 30 m away: the guard’s memory still returns the last-known position', () => {
    // Memory has no access to the world; only percepts move it. Hearing other things leaves it alone.
    const records: MemoryRecord[] = [];
    observePercepts(records, [seen(P)], 0, HZ);
    for (let tick = 6; tick <= 600; tick += 6) {
      observePercepts(
        records,
        tick === 300 ? [seen(east(P, 30), ROCK, 'heard-noise')] : [],
        tick,
        HZ,
      );
    }
    const recalled = recall(records, PLAYER, 600, HZ);
    expect(recalled).toMatchObject({ lkp: P, predicted: P, origin: 'own', seenTick: 0 });
  });

  it('AC-3: an ally’s shouted report of the player at Q makes Q the last-known position, at confidence × 0.7, second-hand', () => {
    const Q: Vec3 = { x: -4, y: 1, z: 20 };
    const records = runningEast();
    // Its own sighting 30 s old has decayed to 0.4: the report (1 × 0.7) is surer.
    expect(applyReport(records, { source: PLAYER, position: Q }, 6 + 30 * HZ, HZ)).toBe(true);
    expect(recall(records, PLAYER, 6 + 30 * HZ, HZ)).toMatchObject({
      lkp: Q,
      predicted: Q,
      velocity: { x: 0, y: 0, z: 0 },
      confidence: 0.7,
      origin: 'second-hand',
    });
    // A report from a reporter who is only half sure: 0.5 × 0.7.
    const fresh: MemoryRecord[] = [];
    applyReport(fresh, { source: PLAYER, position: Q, confidence: 0.5 }, 0, HZ);
    expect(fresh[0]).toMatchObject({
      lkp: Q,
      confidence: 0.35,
      origin: 'second-hand',
      kind: 'seen-target',
    });
  });

  it('AC-4: with confidence decay 0.02/s from 1.0, after 50 s the memory is forgotten and queries return none', () => {
    expect(DEFAULT_MEMORY_TUNING.decayPerS).toBe(0.02);
    const records: MemoryRecord[] = [];
    observePercepts(records, [seen(P)], 0, HZ);
    expect(confidenceAt(first(records), 25 * HZ, HZ)).toBeCloseTo(0.5, 9);
    expect(recall(records, PLAYER, 50 * HZ - 1, HZ)?.confidence).toBeGreaterThan(0);
    expect(recall(records, PLAYER, 50 * HZ, HZ)).toBeUndefined();
    expect(forgetStale(records, 50 * HZ, HZ)).toEqual([PLAYER]);
    expect(records).toEqual([]);
  });

  it('velocity comes only from two own sightings close in time; other fixes stop it', () => {
    const records = runningEast();
    // A sighting more than the window after the last gives no velocity.
    observePercepts(records, [seen(east(P, 5))], 6 + 2 * HZ, HZ);
    expect(records[0]?.velocity).toEqual({ x: 0, y: 0, z: 0 });
    // Two fixes in one tick keep what was known of the motion.
    const twice = runningEast();
    observePercepts(twice, [seen(east(P, 1))], 6, HZ);
    expect(twice[0]?.velocity.x).toBeCloseTo(3, 9);
    expect(twice[0]?.lkp).toEqual(east(P, 1));
    // Heard, not seen: a position fix without motion.
    const heard = runningEast();
    observePercepts(heard, [seen(east(P, 0.3), PLAYER, 'heard-noise', 0.5)], 12, HZ);
    expect(heard[0]).toMatchObject({
      velocity: { x: 0, y: 0, z: 0 },
      kind: 'heard-noise',
      confidence: 0.5,
    });
    // After a second-hand report, a sighting starts the motion afresh.
    const told = runningEast();
    applyReport(told, { source: PLAYER, position: P }, 7, HZ, {
      ...DEFAULT_MEMORY_TUNING,
      secondHand: 0.99,
    });
    expect(told[0]?.origin).toBe('own'); // its own sighting (1.0) was at least as sure
    applyReport(told, { source: PLAYER, position: P }, 6 + 10 * HZ, HZ);
    observePercepts(told, [seen(east(P, 1))], 12 + 10 * HZ, HZ);
    expect(told[0]).toMatchObject({ origin: 'own', velocity: { x: 0, y: 0, z: 0 } });
  });

  it('a fix takes the surest percept of a source (sight first on a tie); a percept with no certainty says nothing', () => {
    const records: MemoryRecord[] = [];
    const update = observePercepts(
      records,
      [
        seen({ x: 1, y: 0, z: 1 }, PLAYER, 'heard-noise', 0.5),
        seen({ x: 2, y: 0, z: 2 }, PLAYER, 'seen-target', 0.5),
        seen({ x: 3, y: 0, z: 3 }, PLAYER, 'seen-target', 0.9),
        seen({ x: 4, y: 0, z: 4 }, ROCK, 'heard-noise', 0),
        seen({ x: 5, y: 0, z: 5 }, BODY, 'seen-anomaly', 0.6),
      ],
      0,
      HZ,
    );
    expect(update).toEqual({ updated: [PLAYER, BODY], removed: [] });
    expect(records.map((r) => r.source)).toEqual([BODY, PLAYER]); // sorted by source
    expect(records[1]).toMatchObject({ lkp: { x: 3, y: 0, z: 3 }, confidence: 0.9 });
    const tie: MemoryRecord[] = [];
    observePercepts(
      tie,
      [seen({ x: 1, y: 0, z: 1 }), seen({ x: 2, y: 0, z: 2 }, PLAYER, 'heard-noise')],
      0,
      HZ,
    );
    expect(tie[0]?.kind).toBe('seen-target');
  });

  it('memories of anomalies persist with their timestamps until their source is gone', () => {
    const records: MemoryRecord[] = [];
    observePercepts(records, [seen(P, BODY, 'seen-anomaly', 0.8)], 60, HZ);
    observePercepts(records, [seen(P, BODY, 'seen-anomaly', 0.8)], 120, HZ);
    const hourLater = 120 + 3600 * HZ;
    expect(recall(records, BODY, hourLater, HZ)).toMatchObject({
      kind: 'seen-anomaly',
      confidence: 0.8,
      firstTick: 60,
      seenTick: 120,
    });
    expect(observePercepts(records, [], hourLater, HZ, DEFAULT_MEMORY_TUNING, () => false)).toEqual(
      {
        updated: [],
        removed: [BODY],
      },
    );
  });

  it('a report never overrides a surer memory of its own, and a report of no confidence is ignored', () => {
    const records = runningEast();
    expect(applyReport(records, { source: PLAYER, position: P, confidence: 0 }, 6, HZ)).toBe(false);
    expect(applyReport(records, { source: PLAYER, position: { x: 0, y: 0, z: 0 } }, 6, HZ)).toBe(
      false,
    );
    expect(records[0]?.lkp).toEqual(P);
    // A second-hand memory is replaced by a newer report even when that is less sure.
    applyReport(records, { source: ROCK, position: P, kind: 'heard-noise' }, 6, HZ);
    applyReport(records, { source: ROCK, position: east(P, 1), confidence: 0.5 }, 12, HZ);
    expect(recall(records, ROCK, 12, HZ)).toMatchObject({ lkp: east(P, 1), confidence: 0.35 });
    expect(records.map((r) => r.source)).toEqual([PLAYER, ROCK]);
  });

  it('tuning sets the cap, the decay and the share of a report', () => {
    const tuning: MemoryTuning = {
      decayPerS: 0.5,
      predictS: 0.5,
      secondHand: 0.5,
      velocityWindowS: 1,
      persistent: [],
    };
    const records = runningEast();
    expect(predictedAt(first(records), 6 + 10 * HZ, HZ, tuning).x).toBeCloseTo(11.5, 9);
    expect(recall(records, PLAYER, 6 + 2 * HZ, HZ, tuning)).toBeUndefined();
    applyReport(records, { source: PLAYER, position: P }, 6 + 2 * HZ, HZ, tuning);
    expect(records[0]?.confidence).toBe(0.5);
    expect(recall(records, ROCK, 0, HZ)).toBeUndefined();
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
    unaware: { transitions: [], timeoutFrom: 'entered', postAlert: false, activities: ['idle'] },
  },
  activities: {
    idle: {
      weight: 1,
      interruptible: true,
      retryAfterS: 2,
      considerations: [],
      steps: [{ do: 'wait', seconds: 100 }],
    },
  },
} as unknown as Frozen<BehaviourDef>;

describe('target memory in a world (mw-e11.8)', () => {
  function setup(memory?: MemoryTuning) {
    const world = registerCreatureComponents(new World<never>({ seed: 1, hz: HZ }));
    installAi(world, { behaviours: compileBehaviours([IDLE]), ...(memory && { memory }) });
    const present = new Set<PerceptSource>([PLAYER, ROCK]);
    installAwareness(world, {
      present: (s) => present.has(s),
      target: (s) => (s === PLAYER ? 7 : undefined),
    });
    const guard = world.spawn();
    giveBrain(world, guard, { behaviour: 'idle' });
    const report = (percepts: readonly Percept[], agent: EntityId = guard) => {
      world.events.emit(perceived, { tick: world.tick, agent, seconds: 0.1, percepts });
      for (let i = 0; i < 6; i++) world.step(); // 0.1 s
    };
    const board = () => brainOf(world, guard)?.blackboard;
    return { world, guard, report, board, present };
  }

  it('awareness keeps the target’s memory: its source, its last-known position, forgetting both with it', () => {
    const { world, guard, report, board } = setup({ ...DEFAULT_MEMORY_TUNING, decayPerS: 0.1 });
    report([seen(P)]);
    expect(board()).toMatchObject({ target: 7, targetSource: PLAYER, lkp: P });
    report([seen(east(P, 0.3))]);
    expect(recallTarget(world, guard)?.velocity.x).toBeCloseTo(3, 9);
    // A noise from elsewhere is remembered too, but is not the target's memory.
    report([seen({ x: 0, y: 0, z: 0 }, ROCK, 'heard-noise')]);
    expect(board()?.lkp).toEqual(east(P, 0.3));
    expect(brainOf(world, guard)?.memory.map((r) => r.source)).toEqual([PLAYER, ROCK]);
    // Out of sight, the awareness record goes long before the memory does (decay 0.1/s: 10 s).
    for (let i = 0; i < 90; i++) report([]);
    expect(board()).toMatchObject({ target: null, targetSource: PLAYER, lkp: east(P, 0.3) });
    expect(recallTarget(world, guard)?.predicted.x).toBeCloseTo(P.x + 0.3 + 4.5, 9);
    for (let i = 0; i < 20; i++) report([]);
    expect(board()).toMatchObject({ target: null, targetSource: null, lkp: null });
    expect(recallTarget(world, guard)).toBeUndefined();
    expect(brainOf(world, guard)?.memory).toEqual([]);
  });

  it('a target that is gone is forgotten at once', () => {
    const { report, board, present } = setup();
    report([seen(P)]);
    present.delete(PLAYER);
    report([]);
    expect(board()).toMatchObject({ target: null, targetSource: null, lkp: null });
  });

  it('AC-3: a heard report reaches memory as second-hand and becomes the last-known position', () => {
    const { world, guard, board } = setup();
    const Q: Vec3 = { x: -4, y: 0, z: 20 };
    // A report of a noise is remembered, but is no target memory.
    expect(hearReport(world, guard, { source: ROCK, position: P, kind: 'heard-noise' })).toBe(true);
    expect(board()).toMatchObject({ targetSource: null, lkp: null });
    expect(memoryTuning(world)).toBe(DEFAULT_MEMORY_TUNING);
    expect(memoryTuning(new World<never>({ seed: 1 }))).toBe(DEFAULT_MEMORY_TUNING); // no AI
    expect(hearReport(world, guard, { source: PLAYER, position: Q, confidence: 0.8 })).toBe(true);
    expect(recallTarget(world, guard)).toMatchObject({ lkp: Q, origin: 'second-hand' });
    expect(recallTarget(world, guard)?.confidence).toBeCloseTo(0.56, 9);
    expect(board()).toMatchObject({ target: null, targetSource: PLAYER, lkp: Q });
    // A report about something else is remembered but leaves its target memory alone.
    expect(hearReport(world, guard, { source: ROCK, position: P })).toBe(true);
    expect(board()?.lkp).toEqual(Q);
    // A report it does not take, and a listener without a brain.
    expect(hearReport(world, guard, { source: PLAYER, position: P, confidence: 0 })).toBe(false);
    expect(hearReport(world, world.spawn(), { source: PLAYER, position: P })).toBe(false);
    expect(recallTarget(world, world.spawn())).toBeUndefined();
  });

  it('struck from the unseen, the guess replaces the target memory as what lkp aims at', () => {
    const { world, guard, report, board } = setup();
    for (const type of DAMAGE_COMPONENTS) if (!world.isRegistered(type)) world.register(type);
    installAlertTriggers(world);
    placeEntity(world, guard, { x: 0, y: 0, z: 0 });
    giveCombatant(world, guard, { health: 100 });
    report([seen(P)]);
    for (let i = 0; i < 30; i++) report([]); // it lost sight of the player
    new DamageModel().apply(world, guard, {
      amounts: { pierce: 1 },
      instigator: null,
      direction: { x: 0, y: 0, z: 1 },
    });
    world.step();
    expect(board()).toMatchObject({ targetSource: null, lkp: { x: 0, y: 0, z: -8 } });
    expect(brainOf(world, guard)?.memory.map((r) => r.source)).toEqual([PLAYER]); // still remembered
  });
});
