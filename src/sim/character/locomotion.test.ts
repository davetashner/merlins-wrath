import type { ControllerTuning, Frozen, GaitTuning } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SimClock } from '../clock';
import { defineComponent } from '../core/component';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import { IDLE_INPUT, SKIN, type CharacterInput, type CharacterState } from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box } from './greybox';
import {
  CharacterLocomotion,
  classifyLocomotion,
  DEFAULT_GAIT_TUNING,
  giveLocomotion,
  impactSpeed,
  initialLocomotion,
  LOCOMOTION_STATES,
  LocomotionEvents,
  locomotionOf,
  locomotionSystem,
  stepLocomotion,
  type LocomotionEvent,
  type LocomotionInputs,
  type LocomotionState,
} from './locomotion';
import { CharacterController, characterControllerSystem, spawnCharacter } from './system';
import type { TraversalHook, TraversalMode } from './traversal';

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

/** One tick's command: the character's input and facing. */
interface Command {
  readonly input: CharacterInput;
  readonly yaw?: number;
}

const input = (
  move: { x: number; y: number },
  buttons: Partial<Record<'jump' | 'sprint' | 'crouch', 'pressed' | 'held'>> = {},
): CharacterInput => {
  const button = (b: 'jump' | 'sprint' | 'crouch') => ({
    pressed: buttons[b] === 'pressed',
    held: buttons[b] !== undefined,
  });
  return {
    actions: { move, jump: button('jump'), sprint: button('sprint'), crouch: button('crouch') },
    cameraYaw: 0,
  };
};
const FORWARD = input({ x: 0, y: 1 });
const IDLE: Command = { input: IDLE_INPUT };

interface Options {
  readonly tuning?: Frozen<ControllerTuning>;
  readonly feet?: { x: number; y: number; z: number };
  readonly hooks?: readonly TraversalHook[];
  readonly facing?: boolean;
}

/** A character on a big flat floor (top at y 0), with locomotion; its events are recorded. */
function makeWorld({ tuning = TUNING, feet, hooks, facing = true }: Options = {}) {
  const collision = new FakeCollisionWorld([
    box({ x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 }),
  ]);
  const world = new World<Command>({ seed: 1 }).register(CharacterController, CharacterLocomotion);
  world.addSystem(
    characterControllerSystem<Command>({
      collision,
      tuning,
      ...(hooks !== undefined && { hooks }),
      input: (inputs) => inputs[0]?.input,
    }),
  );
  let yaw = 0;
  world.addSystem(
    locomotionSystem<Command>({
      tuning,
      moving: (inputs) => {
        const move = inputs[0]?.input.actions.move;
        return move !== undefined && (move.x !== 0 || move.y !== 0);
      },
      ...(facing && { facing: () => yaw }),
    }),
  );
  const entity = spawnCharacter(world, feet ?? { x: 0, y: SKIN, z: 0 });
  giveLocomotion(world, entity);
  const events: LocomotionEvent[] = [];
  world.events.on(LocomotionEvents, (e) => events.push(e));
  const snapshot = () => {
    const value = locomotionOf(world, entity);
    if (value === undefined) throw new Error('no locomotion');
    return value;
  };
  const step = (command: Command = IDLE) => {
    if (command.yaw !== undefined) yaw = command.yaw;
    world.step([command]);
    return snapshot();
  };
  return { world, entity, events, snapshot, step };
}

describe('classifyLocomotion', () => {
  const at = (speed: number, extra: Partial<LocomotionInputs> = {}): LocomotionState =>
    classifyLocomotion(
      {
        grounded: true,
        crouched: false,
        sprinting: false,
        traversal: null,
        speed,
        moving: true,
        landingTicks: 0,
        ...extra,
      },
      DEFAULT_GAIT_TUNING,
    );

  it('AC-1: idle below 0.2 m/s, walk from 0.2, run from 2.5 m/s (the documented thresholds)', () => {
    expect(DEFAULT_GAIT_TUNING.walkFrom).toBe(0.2);
    expect(DEFAULT_GAIT_TUNING.runFrom).toBe(2.5);
    expect(at(0)).toBe('idle');
    expect(at(0.1999)).toBe('idle');
    expect(at(0.2)).toBe('walk');
    expect(at(2.4999)).toBe('walk');
    expect(at(2.5)).toBe('run');
    expect(at(9)).toBe('run');
  });

  it('sprints only at run speed or faster; crouch, landing, airborne and traversal come first', () => {
    expect(at(6, { sprinting: true })).toBe('sprint');
    expect(at(1, { sprinting: true })).toBe('walk');
    expect(at(1, { crouched: true })).toBe('crouch');
    expect(at(0, { crouched: true, moving: false })).toBe('crouch');
    expect(at(3, { crouched: true, landingTicks: 2 })).toBe('landing');
    expect(at(3, { grounded: false, landingTicks: 2 })).toBe('airborne');
    for (const mode of ['climb', 'mantle', 'swim'] as const) {
      expect(at(3, { grounded: false, traversal: mode })).toBe(mode);
    }
  });

  it('AC-3: without move input a moving character is idle, however fast it goes', () => {
    expect(at(4, { moving: false })).toBe('idle');
    expect(at(4, { moving: false, sprinting: true })).toBe('idle');
  });

  it('lists every state once', () => {
    expect(new Set(LOCOMOTION_STATES).size).toBe(10);
  });
});

describe('impactSpeed', () => {
  it('is exact under constant gravity, capped at the fall-speed limit, never negative', () => {
    expect(impactSpeed({ y: 3, vy: 0 }, 0, TUNING)).toBeCloseTo(Math.sqrt(150), 12);
    expect(impactSpeed({ y: 1, vy: -5 }, 0, TUNING)).toBeCloseTo(Math.sqrt(25 + 50), 12);
    expect(impactSpeed({ y: 500, vy: -30 }, 0, TUNING)).toBe(40);
    // Landing above the last airborne height with nothing left to rise on: 0, not NaN.
    expect(impactSpeed({ y: 0, vy: 0 }, 0.5, TUNING)).toBe(0);
  });
});

describe('locomotion system (mw-e02.6)', () => {
  it('AC-1: accelerating from idle to a run, sampled states go idle → walk → run at 0.2 and 2.5 m/s', () => {
    const { step } = makeWorld();
    const samples = [step(), step()];
    for (let i = 0; i < 20; i++) samples.push(step({ input: FORWARD }));
    for (const s of samples) {
      const expected = s.speed < 0.2 ? 'idle' : s.speed < 2.5 ? 'walk' : 'run';
      expect(s.state).toBe(expected);
      expect(s.normalizedSpeed).toBeCloseTo(s.speed / 5, 12);
      expect(s.grounded).toBe(true);
    }
    const order = samples.map((s) => s.state).filter((s, i, all) => s !== all[i - 1]);
    expect(order).toEqual(['idle', 'walk', 'run']);
    expect(samples.at(-1)?.speed).toBeCloseTo(5, 9);
  });

  it('AC-1: a slow analog push walks, below 0.2 m/s it stays idle', () => {
    const { step } = makeWorld();
    let s = step();
    for (let i = 0; i < 30; i++) s = step({ input: input({ x: 0, y: 0.3 }) });
    expect(s.speed).toBeCloseTo(1.5, 9);
    expect(s.state).toBe('walk');
    for (let i = 0; i < 30; i++) s = step({ input: input({ x: 0, y: 0.03 }) });
    expect(s.speed).toBeCloseTo(0.15, 9);
    expect(s.state).toBe('idle');
  });

  it('AC-2: a 3 m fall fires exactly one land event, impactSpeed within ±2% of √(2·g·3)', () => {
    const { step, events, world } = makeWorld({ feet: { x: 0, y: 3 + SKIN, z: 0 } });
    const states: LocomotionState[] = [];
    for (let i = 0; i < 90; i++) states.push(step().state);
    const lands = events.filter((e) => e.kind === 'land');
    expect(lands).toHaveLength(1);
    const analytic = Math.sqrt(2 * TUNING.gravity * 3);
    const impact = lands[0]?.kind === 'land' ? lands[0].impactSpeed : NaN;
    expect(Math.abs(impact - analytic) / analytic).toBeLessThanOrEqual(0.02);
    expect(impact).toBeCloseTo(analytic, 9); // in fact exact
    // Airborne until touchdown, then the landing state for 150 ms (9 ticks), then idle.
    const landedAt = states.indexOf('landing');
    expect(landedAt).toBeGreaterThan(20);
    expect(states.slice(0, landedAt).every((s) => s === 'airborne')).toBe(true);
    expect(states.slice(landedAt, landedAt + 9)).toEqual(Array<string>(9).fill('landing'));
    expect(states[landedAt + 9]).toBe('idle');
    expect(lands[0]?.tick).toBe(landedAt);
    expect(lands[0]?.entity).toBeDefined();
    expect(world.tick).toBe(90);
  });

  it('a soft landing (below hardLanding) is only an event: the state goes straight on', () => {
    const { step, events } = makeWorld({ feet: { x: 0, y: 0.3 + SKIN, z: 0 } });
    const states: LocomotionState[] = [];
    for (let i = 0; i < 30; i++) states.push(step().state);
    expect(events.filter((e) => e.kind === 'land')).toHaveLength(1);
    expect(states).not.toContain('landing');
  });

  it('AC-3: shoved sideways while idle, the character is not walking unless move input is present', () => {
    const { world, entity, step } = makeWorld();
    step();
    const shove = () => {
      const state = world.get(entity, CharacterController);
      if (state === undefined) throw new Error('no character');
      world.set(entity, CharacterController, { ...state, velocity: { x: 4, y: 0, z: 0 } });
    };
    shove();
    const pushed = [step(), step(), step()];
    expect(pushed[0]?.speed).toBeGreaterThan(2.5);
    expect(pushed.map((s) => s.state)).toEqual(['idle', 'idle', 'idle']);
    shove();
    expect(step({ input: FORWARD }).state).toBe('run');
  });

  it('jumping emits jumpStart once, rises then falls airborne, and lands (a hard landing)', () => {
    const { step, events } = makeWorld();
    step();
    const air = [step({ input: input({ x: 0, y: 0 }, { jump: 'pressed' }) })];
    for (let i = 0; i < 60; i++) air.push(step());
    expect(events.filter((e) => e.kind === 'jumpStart')).toHaveLength(1);
    expect(air[0]?.state).toBe('airborne');
    expect(air[0]?.verticalSpeed).toBeGreaterThan(0);
    expect(air.some((s) => s.state === 'airborne' && s.verticalSpeed < 0)).toBe(true);
    const land = events.find((e) => e.kind === 'land');
    expect(land?.kind === 'land' && land.impactSpeed).toBeCloseTo(Math.sqrt(2 * 25 * 1.2), 9);
    expect(air).toContainEqual(expect.objectContaining({ state: 'landing' }));
    expect(events.map((e) => e.kind)).toEqual(['jumpStart', 'land']);
  });

  it('footsteps alternate feet every gait spacing of ground travelled, half a step in', () => {
    const { step, events } = makeWorld();
    step();
    let travelled = 0;
    for (let i = 0; i < 120; i++) travelled += step({ input: FORWARD }).speed / 60;
    const steps = events.flatMap((e) => (e.kind === 'footstep' ? [e] : []));
    expect(steps.map((e) => e.foot).slice(0, 4)).toEqual(['left', 'right', 'left', 'right']);
    // Running 1.0 m apart after the first half step (0.35 m in, the walk spacing's half).
    expect(steps.length).toBe(Math.floor(travelled + 0.35));
    expect(new Set(steps.map((e) => e.gait))).toEqual(new Set(['run']));
  });

  it('sprinting and crouching step with their own gaits; standing still takes no steps', () => {
    const gaits = (command: Command) => {
      const { step, events } = makeWorld();
      step();
      for (let i = 0; i < 90; i++) step(command);
      const idleFrom = events.length;
      for (let i = 0; i < 30; i++) step();
      const trailing = events.slice(idleFrom).filter((e) => e.kind === 'footstep');
      return {
        gaits: new Set(
          events
            .slice(0, idleFrom)
            .flatMap((e) => (e.kind === 'footstep' && e.tick > 30 ? [e.gait] : [])),
        ),
        trailing: trailing.length,
      };
    };
    expect(gaits({ input: input({ x: 0, y: 1 }, { sprint: 'held' }) }).gaits).toEqual(
      new Set(['sprint']),
    );
    expect(gaits({ input: input({ x: 0, y: 1 }, { crouch: 'held' }) }).gaits).toEqual(
      new Set(['crouch']),
    );
    // Once stopped (idle within the decel time), no more footsteps.
    expect(gaits({ input: FORWARD }).trailing).toBeLessThanOrEqual(1);
  });

  it('turn rate is the facing yaw change per second, wrapped; 0 on the first tick or without facing', () => {
    const { step } = makeWorld();
    expect(step({ ...IDLE, yaw: 1 }).turnRate).toBe(0);
    expect(step({ ...IDLE, yaw: 1.1 }).turnRate).toBeCloseTo(6, 9);
    expect(step({ ...IDLE, yaw: 1.1 }).turnRate).toBe(0);
    step({ ...IDLE, yaw: Math.PI - 0.05 });
    // Across ±π: a 0.1 rad turn to the left, not a full turn to the right.
    expect(step({ ...IDLE, yaw: -Math.PI + 0.05 }).turnRate).toBeCloseTo(6, 9);
    expect(step({ ...IDLE, yaw: Math.PI - 0.05 }).turnRate).toBeCloseTo(-6, 9);
    // A half turn exactly reads as a turn to the left (angles wrap into (−π, π]).
    step({ ...IDLE, yaw: Math.PI / 2 });
    expect(step({ ...IDLE, yaw: -Math.PI / 2 }).turnRate).toBeCloseTo(Math.PI * 60, 9);
    const blind = makeWorld({ facing: false });
    blind.step({ ...IDLE, yaw: 1 });
    expect(blind.step({ ...IDLE, yaw: 2 }).turnRate).toBe(0);
  });

  it('uses the profile’s own gait tuning when it has one', () => {
    const gait: Frozen<GaitTuning> = { ...DEFAULT_GAIT_TUNING, walkFrom: 1, runFrom: 4.5 };
    const { step } = makeWorld({ tuning: { ...TUNING, gait } });
    step();
    const states: LocomotionState[] = [];
    for (let i = 0; i < 12; i++) states.push(step({ input: FORWARD }).state);
    // 0.56 m/s per tick: idle below 1, walk to 4.5, run from there.
    expect(states.slice(0, 4)).toEqual(['idle', 'walk', 'walk', 'walk']);
    expect(states[7]).toBe('walk');
    expect(states[8]).toBe('run');
  });

  it('reports traversal modes, and mantleStart and ledgeGrab (a climb entered in the air)', () => {
    const hook = (mode: TraversalMode, from: number, to: number): TraversalHook => ({
      mode,
      shouldEnter: ({ state }) => state.airTicks === 0 && ticks >= from && ticks < to,
      step: ({ state }) => ({
        ...state,
        traversal: ticks < to ? mode : null,
        grounded: mode === 'swim',
      }),
    });
    let ticks = 0;
    const run = (hooks: TraversalHook[], feet = { x: 0, y: SKIN, z: 0 }) => {
      ticks = 0;
      const { step, events } = makeWorld({ hooks, feet });
      const states: LocomotionState[] = [];
      for (; ticks < 12; ticks++) states.push(step().state);
      return { states, kinds: events.map((e) => e.kind) };
    };
    const mantle = run([hook('mantle', 3, 6)]);
    expect(mantle.states.slice(3, 6)).toEqual(['mantle', 'mantle', 'mantle']);
    expect(mantle.kinds.filter((k) => k === 'mantleStart')).toHaveLength(1);
    const swim = run([hook('swim', 3, 6)]);
    expect(swim.states[4]).toBe('swim');
    expect(swim.kinds).not.toContain('mantleStart');
    // Climbing from the ground is no ledge grab; grabbing on while falling is.
    expect(run([hook('climb', 3, 6)]).kinds).not.toContain('ledgeGrab');
    const grab: TraversalHook = {
      mode: 'climb',
      shouldEnter: ({ state }) => state.airTicks >= 2,
      step: ({ state }) => ({ ...state, traversal: 'climb', grounded: false }),
    };
    const fall = run([grab], { x: 0, y: 3, z: 0 });
    expect(fall.kinds).toEqual(['ledgeGrab']);
    expect(fall.states.at(-1)).toBe('climb');
  });

  it('leaves characters without CharacterLocomotion alone; locomotionOf is undefined for them', () => {
    const { world, step } = makeWorld();
    const other = spawnCharacter(world, { x: 5, y: SKIN, z: 0 });
    step();
    step();
    expect(locomotionOf(world, other)).toBeUndefined();
    expect(world.get(other, CharacterController)).toBeDefined();
  });

  it('is sim state: snapshotted and hashed, so the same inputs give the same hash', () => {
    const run = () => {
      const { world, step } = makeWorld();
      for (let i = 0; i < 90; i++) {
        step(i % 20 === 0 ? { input: input({ x: 0, y: 1 }, { jump: 'pressed' }) } : IDLE);
      }
      return hashWorld(world);
    };
    expect(run()).toBe(run());
    const { world, entity } = makeWorld();
    expect(world.get(entity, CharacterLocomotion)).toEqual(initialLocomotion());
  });
});

describe('stepLocomotion', () => {
  const clock = new SimClock(60);
  const character: CharacterState = {
    position: { x: 0, y: SKIN, z: 0 },
    velocity: { x: 3, y: 0, z: 4 },
    grounded: true,
    groundNormal: { x: 0, y: 1, z: 0 },
    groundBody: null,
    crouched: false,
    sprinting: false,
    airTicks: 0,
    jumped: false,
    jumpAge: -1,
    traversal: null,
  };

  it('is pure: the same inputs give the same result and nothing is mutated', () => {
    const last = Object.freeze(initialLocomotion());
    const context = { tuning: TUNING, gait: DEFAULT_GAIT_TUNING, clock };
    const tick = { character, moving: true, yaw: 0.5 };
    const a = stepLocomotion(last, tick, context);
    expect(stepLocomotion(last, tick, context)).toEqual(a);
    expect(a.locomotion).toMatchObject({ state: 'run', speed: 5, normalizedSpeed: 1, yaw: 0.5 });
    expect(a.events).toEqual([]);
  });

  it('works with any component registry (a component of another name is not locomotion)', () => {
    const Other = defineComponent<number>('test.other');
    const world = new World({ seed: 1 }).register(Other, CharacterLocomotion);
    const id = world.spawn();
    world.add(id, Other, 1);
    expect(locomotionOf(world, id)).toBeUndefined();
  });
});
