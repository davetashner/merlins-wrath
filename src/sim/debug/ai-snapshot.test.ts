// AI introspection snapshots (mw-e11.17): what the AI debug overlay reads for each agent.
import type { BehaviourDef, Frozen, NavAgent, SenseProfile } from '@content/index';
import { describe, expect, it } from 'vitest';
import { compileBehaviours } from '../ai/behaviour';
import { BrainComponent, type Brain } from '../ai/components';
import { giveBrain, installAi } from '../ai/runtime';
import { CombatFacingComponent } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  CreatureComponent,
  CreatureNavComponent,
  CreatureSensesComponent,
} from '../creatures/components';
import { registerCreatureComponents } from '../creatures/spawn';
import { NavRouteComponent } from '../nav/navigation';
import { entitySource, soundSource } from '../perception/percept';
import { DEFAULT_PERCEPTION_TUNING } from '../perception/tuning';
import { PlacementComponent } from '../stimulus/placement';
import { aiSnapshotter } from './ai-snapshot';

const SENSES = {
  sight: {
    nearRange: 8,
    farRange: 20,
    primaryHalfAngle: 35,
    peripheralHalfAngle: 80,
    verticalHalfAngle: 40,
    darkVision: 0.2,
    detectionSpeed: 1,
  },
  hearing: { thresholdDb: 30, range: 25 },
} as unknown as Frozen<SenseProfile>;

const NAV = { radius: 0.4, height: 1.8 } as unknown as Frozen<NavAgent>;

const PROFILE = {
  id: 'snap-guard',
  schemaVersion: 1,
  tuning: {},
  thinkHz: 10,
  inertia: 0.1,
  initial: 'unaware',
  states: { unaware: { transitions: [], activities: ['idle'] } },
  activities: {
    idle: {
      weight: 1,
      interruptible: true,
      retryAfterS: 2,
      considerations: [],
      steps: [{ do: 'wait', seconds: 5 }],
    },
  },
} as unknown as Frozen<BehaviourDef>;

function world(): World<never> {
  const w = registerCreatureComponents(new World<never>({ seed: 3 }));
  w.register(NavRouteComponent);
  installAi(w, { behaviours: compileBehaviours([PROFILE]) });
  return w;
}

/** A creature-like agent with senses, a nav agent and a placement. */
function agent(w: World<never>, x: number, z: number): EntityId {
  const e = w.spawn();
  w.add(e, PlacementComponent, { x, y: 0, z, radius: 0.4 });
  w.add(e, CreatureSensesComponent, SENSES);
  w.add(e, CreatureNavComponent, NAV);
  w.add(e, CombatFacingComponent, { facing: { x: 3, y: 0, z: 4 } });
  w.add(e, CreatureComponent, {
    origin: { creature: 'snap-guard', at: { x, y: 0, z }, facing: { x: 0, y: 0, z: 1 } },
    behaviour: 'snap-guard',
    tuning: {},
    needs: {},
  });
  return e;
}

function brain(w: World<never>, e: EntityId): Brain {
  const found = w.get(e, BrainComponent);
  if (found === undefined) throw new Error('no brain');
  return found;
}

describe('AI introspection snapshots (mw-e11.17)', () => {
  it('AC-1: an agent’s snapshot has its state, time in state, awareness per source, LKP, path and cone parameters', () => {
    const w = world();
    const guard = agent(w, 2, 3);
    const player = w.spawn();
    giveBrain(w, guard, { behaviour: 'snap-guard', gaits: { sneak: 1, walk: 2, run: 4 } });
    for (let i = 0; i < 60; i++) w.step(); // 1 s at 60 Hz: thinking, idling
    const b = brain(w, guard);
    b.awareness.push(
      {
        source: soundSource('throw'),
        level: 0.4,
        quietS: 1,
        cause: {
          kind: 'heard-noise',
          sense: 'hearing',
          position: { x: 9, y: 0, z: 9 },
          amount: 0.4,
        },
      },
      {
        source: entitySource(player),
        level: 0.7,
        quietS: 0,
        cause: { kind: 'seen-target', sense: 'sight', position: { x: 5, y: 0, z: 5 }, amount: 0.1 },
      },
    );
    b.blackboard.target = player;
    b.blackboard.lkp = { x: 5, y: 0, z: 5 };
    w.add(guard, NavRouteComponent, {
      goal: { x: 8, y: 0, z: 8 },
      status: 'ready',
      request: 0,
      points: [
        { x: 2, y: 0, z: 3 },
        { x: 4, y: 0, z: 6 },
        { x: 8, y: 0, z: 8 },
      ],
      index: 1,
      doors: '',
    });
    w.step();

    const snap = aiSnapshotter(w).build();
    expect(snap.tick).toBe(w.tick);
    expect(snap.thresholds).toEqual({ suspicious: 0.3, investigating: 0.6, detected: 1 });
    expect(snap.agents).toHaveLength(1);
    const [a] = snap.agents;
    expect(a).toMatchObject({
      entity: guard,
      creature: 'snap-guard',
      feet: { x: 2, y: 0, z: 3 },
      eye: { x: 2, y: DEFAULT_PERCEPTION_TUNING.sight.eyeHeight * 1.8, z: 3 },
      facing: { x: 0.6, y: 0, z: 0.8 },
      cone: {
        primaryHalfAngle: 35,
        peripheralHalfAngle: 80,
        verticalHalfAngle: 40,
        nearRange: 8,
        farRange: 20,
      },
      hearing: { thresholdDb: 30, range: 25 },
      lkp: { position: { x: 5, y: 0, z: 5 }, confidence: 0.7 },
      route: {
        status: 'ready',
        goal: { x: 8, y: 0, z: 8 },
        points: [
          { x: 4, y: 0, z: 6 },
          { x: 8, y: 0, z: 8 },
        ],
      },
    });
    expect(a?.brain).toMatchObject({
      behaviour: 'snap-guard',
      state: 'unaware',
      postAlert: false,
      activity: 'idle',
      step: 0,
      primitive: 'wait',
      nodePath: ['unaware', 'idle', '0:wait'],
      scores: [['idle', expect.any(Number) as number]],
    });
    expect(a?.brain?.timeInState).toBeCloseTo((w.tick - b.enteredTick) / 60, 9);
    expect(a?.brain?.timeInState).toBeGreaterThan(1);
    // Highest first.
    expect(a?.awareness.map((r) => [r.source, r.level, r.sense, r.kind])).toEqual([
      [entitySource(player), 0.7, 'sight', 'seen-target'],
      ['sound:throw', 0.4, 'hearing', 'heard-noise'],
    ]);
    expect(a?.awareness[0]?.position).toEqual({ x: 5, y: 0, z: 5 });
    expect(a?.awareness[1]?.quietS).toBe(1);
    expect(a?.detail).toBeUndefined();
  });

  it('includes the full brain readout of the detail agent only', () => {
    const w = world();
    const a = agent(w, 0, 0);
    const b = agent(w, 4, 0);
    giveBrain(w, a, { behaviour: 'snap-guard' });
    giveBrain(w, b, { behaviour: 'snap-guard' });
    for (let i = 0; i < 10; i++) w.step();
    const snap = aiSnapshotter(w).build(b);
    expect(snap.agents.map((x) => x.entity)).toEqual([a, b]);
    expect(snap.agents[0]?.detail).toBeUndefined();
    expect(snap.agents[1]?.detail).toMatchObject({ entity: b, state: 'unaware', activity: 'idle' });
  });

  it('LKP confidence falls back to the overall awareness without a target record; no LKP, no marker', () => {
    const w = world();
    const guard = agent(w, 0, 0);
    giveBrain(w, guard, { behaviour: 'snap-guard' });
    w.step();
    const snapper = aiSnapshotter(w);
    expect(snapper.build().agents[0]?.lkp).toBeNull();
    const b = brain(w, guard);
    b.blackboard.lkp = { x: 1, y: 0, z: 1 };
    b.blackboard.awareness = 0.45;
    expect(snapper.build().agents[0]?.lkp).toEqual({
      position: { x: 1, y: 0, z: 1 },
      confidence: 0.45,
    });
    b.blackboard.target = 99; // a target it has no record of
    expect(snapper.build().agents[0]?.lkp?.confidence).toBe(0.45);
  });

  it('a brain whose behaviour AI does not know, idle or not, shows no primitive', () => {
    const w = world();
    const guard = agent(w, 0, 0);
    giveBrain(w, guard, { behaviour: 'snap-guard' });
    w.step();
    const b = brain(w, guard);
    b.behaviour = 'unknown';
    b.activity = 'idle';
    b.postAlertUntil = w.tick + 10;
    expect(aiSnapshotter(w).build().agents[0]?.brain).toMatchObject({
      primitive: null,
      nodePath: ['unaware', 'idle', '0:null'],
      postAlert: true,
    });
    b.activity = null;
    expect(aiSnapshotter(w).build().agents[0]?.brain).toMatchObject({
      activity: null,
      primitive: null,
      nodePath: ['unaware'],
    });
  });

  it('a blind, deaf, brainless sensing entity: default eye height, +z facing, no cone, hearing, brain or route', () => {
    const w = registerCreatureComponents(new World<never>({ seed: 1 }));
    const e = w.spawn();
    w.add(e, PlacementComponent, { x: 1, y: 2, z: 3, radius: 0.3 });
    w.add(e, CreatureSensesComponent, {});
    w.add(e, CombatFacingComponent, { facing: { x: 0, y: 1, z: 0 } });
    const snap = aiSnapshotter(w, {
      thresholds: { suspicious: 0.1, investigating: 0.2, detected: 0.9 },
    }).build();
    expect(snap.thresholds.detected).toBe(0.9);
    expect(snap.agents).toEqual([
      {
        entity: e,
        creature: null,
        feet: { x: 1, y: 2, z: 3 },
        eye: { x: 1, y: 2 + DEFAULT_PERCEPTION_TUNING.sight.defaultEyeHeight, z: 3 },
        facing: { x: 0, y: 0, z: 1 },
        cone: null,
        hearing: null,
        brain: null,
        awareness: [],
        lkp: null,
        route: null,
      },
    ]);
  });

  it('AC-5: counts the snapshots it builds; a world without creatures has no agents', () => {
    const w = new World<never>({ seed: 1 });
    const snapper = aiSnapshotter(w);
    expect(snapper.builds).toBe(0);
    expect(snapper.build().agents).toEqual([]);
    snapper.build();
    expect(snapper.builds).toBe(2);
  });

  it('reading a snapshot changes nothing in the world', () => {
    const w = world();
    const guard = agent(w, 0, 0);
    giveBrain(w, guard, { behaviour: 'snap-guard' });
    for (let i = 0; i < 5; i++) w.step();
    const before = JSON.stringify(w.snapshot());
    aiSnapshotter(w).build(guard);
    expect(JSON.stringify(w.snapshot())).toBe(before);
  });
});
