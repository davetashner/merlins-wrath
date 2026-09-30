import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SimClock } from '../clock';
import { hypot } from '../math';
import { World } from '../core/world';
import { addProperties, registerWorldProperties } from '../properties/components';
import { hashWorld } from '../snapshot';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import type { CollisionWorld } from './collision-world';
import {
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  SKIN,
  stepCharacter,
  stepCharacterWithImpacts,
  type CharacterImpact,
  type CharacterInput,
  type CharacterState,
} from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box, rampAt, type GreyboxShape } from './greybox';
import {
  applyCharacterImpulse,
  impelCharacter,
  installCharacterImpulses,
  type CharacterImpulse,
} from './impulse';
import {
  CharacterController,
  CharacterImpacted,
  characterControllerSystem,
  spawnCharacter,
  type CharacterImpactInfo,
} from './system';

/** The player's tuning (a fixture copy; the shipped file is checked in tests/contracts). */
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
  launch: { airControl: 0.1, recoveryMs: 250 },
};

const HZ = 60;
const DT = 1 / HZ;
const params = controllerParams(TUNING, new SimClock(HZ));
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const FLOOR = box(v(-50, -1, -50), v(50, 0, 50));

function move(x: number, y: number, extra: Partial<CharacterInput> = {}): CharacterInput {
  return { ...IDLE_INPUT, actions: { ...IDLE_INPUT.actions, move: { x, y } }, ...extra };
}

/** A character in a fake world, stepped with impact reports. */
class Rig {
  readonly world: CollisionWorld;
  state: CharacterState;
  readonly impacts: CharacterImpact[] = [];

  constructor(shapes: readonly GreyboxShape[], feet = v(0, 0, 0)) {
    this.world = new FakeCollisionWorld(shapes);
    this.state = initialCharacterState(feet);
  }

  step(input: CharacterInput = IDLE_INPUT, ticks = 1): CharacterState {
    for (let i = 0; i < ticks; i++) {
      const next = stepCharacterWithImpacts(this.state, input, {
        world: this.world,
        tuning: TUNING,
        params,
      });
      this.state = next.state;
      this.impacts.push(...next.impacts);
    }
    return this.state;
  }

  impel(impulse: CharacterImpulse): CharacterState {
    this.state = impelCharacter(this.state, impulse);
    return this.state;
  }
}

function onFloor(extra: readonly GreyboxShape[] = [], feet = v(0, 0, 0)): Rig {
  const rig = new Rig([FLOOR, ...extra], feet);
  rig.step(IDLE_INPUT, 3);
  expect(rig.state.grounded).toBe(true);
  expect(rig.impacts).toEqual([]);
  return rig;
}

describe('impulses and the launched state (mw-e02.15)', () => {
  it('AC-1: 10 m/s horizontal + 5 m/s up launches a grounded player along the ballistic arc within 1%', () => {
    const rig = onFloor();
    const start = rig.state.position;
    rig.impel({ velocity: v(10, 5, 0), stagger: true });
    expect(rig.state).toMatchObject({
      velocity: v(10, 5, 0),
      grounded: false,
      groundBody: null,
      jumped: true,
      launch: { source: null, stagger: true },
    });
    let t = 0;
    while (!rig.step().grounded) {
      t += DT;
      expect(rig.state.launch).toEqual({ source: null, stagger: true });
      const expected = v(start.x + 10 * t, start.y + 5 * t - 0.5 * 25 * t * t, start.z);
      const travelled = hypot(expected.x - start.x, expected.y - start.y);
      const error = hypot(
        rig.state.position.x - expected.x,
        rig.state.position.y - expected.y,
        rig.state.position.z - expected.z,
      );
      expect(error).toBeLessThanOrEqual(0.01 * travelled);
    }
    // Flight time 2·5/25 = 0.4 s; it lands 4 m on, the launch over and its landing reported.
    expect(t).toBeCloseTo(0.4, 1);
    expect(rig.state.position.x).toBeCloseTo(4, 1);
    expect(rig.state.launch).toBeUndefined();
    expect(rig.impacts).toEqual([
      {
        kind: 'ground',
        speed: expect.closeTo(5, 6) as number,
        height: expect.closeTo(0.5, 6) as number,
        normal: v(0, 1, 0),
        body: 1,
        launch: { source: null, stagger: true },
      },
    ]);
  });

  it('AC-4: two impulses in the same tick sum, and the result does not depend on their order', () => {
    const airborne: CharacterState = {
      ...initialCharacterState(v(0, 5, 0)),
      velocity: v(0.1, -3, 0.7),
    };
    const a = { velocity: v(0.2, 0.3, -0.1), source: 5 };
    const b = { velocity: v(0.3, 0.6, 0.2), source: 9, stagger: true };
    const c = { velocity: v(-0.7, 0.1, 0.3) };
    const ab = impelCharacter(impelCharacter(airborne, a), b);
    const ba = impelCharacter(impelCharacter(airborne, b), a);
    expect(ab).toEqual(ba);
    expect(ab.velocity).toEqual({
      x: 0.1 + (0.2 + 0.3),
      y: -3 + (0.3 + 0.6),
      z: 0.7 + (-0.1 + 0.2),
    });
    // Three, in every order: the same bits (floating-point sums are order-sensitive; the canonical
    // order makes them not).
    const orders = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    const results = orders.map((order) => order.reduce(impelCharacter, airborne));
    for (const result of results) expect(result).toEqual(results[0]);
    // The strongest push with a source takes the credit; any staggering part staggers.
    expect(ab.launch).toEqual({ source: 9, stagger: true });
    expect(results[0]?.launch).toEqual({ source: 9, stagger: true });
  });

  it('AC-4: two systems pushing in either order leave the world in the same state', () => {
    const run = (order: 'ab' | 'ba') => {
      const world = new World<never>({ seed: 1 }).register(CharacterController);
      const e = spawnCharacter(world, v(0, 3, 0));
      const pushes = { a: v(0.1, 0.2, 0.3), b: v(0.3, 0.2, 0.1) };
      for (const key of order.split('') as ('a' | 'b')[]) {
        world.addSystem({
          name: key,
          run: () => applyCharacterImpulse(world, e, { velocity: pushes[key], source: e }),
        });
      }
      world.step();
      return hashWorld(world);
    };
    expect(run('ab')).toBe(run('ba'));
  });

  it('the next step consumes pending impulses; a later impulse starts from the new velocity', () => {
    const rig = onFloor();
    rig.impel({ velocity: v(0, 5, 0) });
    expect(rig.state.impulses?.parts).toHaveLength(1);
    rig.step();
    expect(rig.state.impulses).toBeUndefined();
    const vy = rig.state.velocity.y;
    rig.impel({ velocity: v(0, -1, 0) });
    expect(rig.state.velocity.y).toBe(vy - 1);
    expect(rig.state.impulses?.base).toEqual(v(0, vy, 0));
  });

  it('a push without rise slides a grounded character along the ground: not launched', () => {
    const rig = onFloor();
    const body = rig.state.groundBody;
    rig.impel({ velocity: v(0, -2, 6), stagger: true });
    expect(rig.state).toMatchObject({ velocity: v(0, -2, 6), grounded: true, groundBody: body });
    expect(rig.state.launch).toBeUndefined();
    rig.step();
    expect(rig.state).toMatchObject({ grounded: true });
    expect(rig.state.velocity.z).toBeLessThan(6);
    expect(rig.state.velocity.y).toBe(0);
  });

  it('a grounded character’s downward speed is dropped before a push lifts it', () => {
    const grounded: CharacterState = {
      ...initialCharacterState(v(0, 0, 0)),
      grounded: true,
      velocity: v(1, -1, 0),
    };
    expect(impelCharacter(grounded, { velocity: v(0, 2, 0) }).velocity).toEqual(v(1, 2, 0));
    // In the air it is kept: a push only adds to the fall.
    const falling = { ...grounded, grounded: false };
    expect(impelCharacter(falling, { velocity: v(0, 2, 0) }).velocity).toEqual(v(1, 1, 0));
  });

  it('the launch is credited to the strongest part, else to the launch already under way', () => {
    const air: CharacterState = { ...initialCharacterState(v(0, 5, 0)), velocity: v(0, 1, 0) };
    const thrown = impelCharacter(air, { velocity: v(3, 0, 0), source: 4 });
    expect(thrown.launch).toEqual({ source: 4, stagger: false });
    // A later sourceless push this tick: the stronger, sourced part keeps the credit.
    expect(impelCharacter(thrown, { velocity: v(0, 1, 0) }).launch).toEqual({
      source: 4,
      stagger: false,
    });
    // Once stepped, a new sourceless push keeps the launch's source and stagger.
    const { impulses: _pending, ...stepped } = thrown;
    expect(_pending).toBeDefined();
    const flying: CharacterState = { ...stepped, launch: { source: 4, stagger: true } };
    expect(impelCharacter(flying, { velocity: v(9, 0, 0) }).launch).toEqual({
      source: 4,
      stagger: true,
    });
    // Equal strengths: the first in canonical order (by velocity, then source).
    const tie = impelCharacter(impelCharacter(air, { velocity: v(0, 2, 0), source: 8 }), {
      velocity: v(2, 0, 0),
      source: 3,
    });
    expect(tie.launch?.source).toBe(8);
    const sameVelocity = impelCharacter(impelCharacter(air, { velocity: v(1, 0, 0), source: 8 }), {
      velocity: v(1, 0, 0),
      source: 3,
    });
    expect(sameVelocity.launch?.source).toBe(3);
    const staggerOrder = impelCharacter(impelCharacter(air, { velocity: v(1, 0, 0) }), {
      velocity: v(1, 0, 0),
      stagger: true,
    });
    expect(staggerOrder.impulses?.parts.map((p) => p.stagger)).toEqual([false, true]);
  });

  it('rejects a non-finite velocity or a bad source', () => {
    const s = initialCharacterState(v(0, 0, 0));
    expect(() => impelCharacter(s, { velocity: v(Number.NaN, 0, 0) })).toThrow(
      'impulse velocity must be finite',
    );
    expect(() => impelCharacter(s, { velocity: v(1, 0, 0), source: 0 })).toThrow(
      'impulse source must be an entity id or null, got 0',
    );
    expect(() => impelCharacter(s, { velocity: v(1, 0, 0), source: 1.5 })).toThrow(RangeError);
  });

  it('while launched: no jump, no root motion, and air control cut to launch.airControl or (staggered) none', () => {
    const steer = (stagger: boolean) => {
      const rig = onFloor();
      rig.impel({ velocity: v(0, 6, 0), stagger });
      const jump = { pressed: true, held: true };
      rig.step(move(1, 0, { actions: { ...move(1, 0).actions, jump }, motion: v(0, 0, 9) }));
      return rig.state;
    };
    const free = steer(false);
    // accel 33.3 m/s² × 0.1 for one tick to the right; the jump and the roll's motion are ignored.
    expect(free.velocity.x).toBeCloseTo((5 / 0.15) * 0.1 * DT, 12);
    expect(free.velocity.z).toBe(0);
    expect(free.velocity.y).toBeCloseTo(6 - 25 * DT, 12);
    const staggered = steer(true);
    expect(staggered.velocity).toEqual(v(0, 6 - 25 * DT, 0));
  });

  it('a staggering launch’s landing ignores movement and jumps for launch.recoveryMs; a free one does not', () => {
    const land = (stagger: boolean) => {
      const rig = onFloor();
      rig.impel({ velocity: v(0, 3, 0), stagger });
      while (!rig.step().grounded);
      return rig;
    };
    const rig = land(true);
    expect(rig.state.recovery).toBe(15);
    const jump = { pressed: true, held: true };
    const push = move(1, 0, { actions: { ...move(1, 0).actions, jump } });
    const x = rig.state.position.x;
    for (let i = 14; i >= 1; i--) {
      rig.step(push);
      expect(rig.state.recovery).toBe(i);
    }
    rig.step(push);
    expect(rig.state.recovery).toBeUndefined();
    expect(rig.state.position.x).toBe(x);
    expect(rig.state.grounded).toBe(true);
    rig.step(push);
    expect(rig.state.position.x).toBeGreaterThan(x);
    const free = land(false);
    expect(free.state.recovery).toBeUndefined();
  });

  it('AC-5: a launched player striking a wall mid-flight loses its horizontal velocity and reports the impact', () => {
    const wall = box(v(3, 0, -5), v(4, 6, 5));
    const rig = onFloor([wall]);
    rig.impel({ velocity: v(12, 4, 0.5), source: 7, stagger: true });
    rig.step(IDLE_INPUT, 20);
    const [hit, landing] = rig.impacts;
    expect(hit).toEqual({
      kind: 'wall',
      speed: 12,
      height: (12 * 12) / (2 * 25),
      normal: v(-1, 0, 0),
      body: 2,
      launch: { source: 7, stagger: true },
    });
    expect(landing?.kind).toBe('ground');
    expect(rig.state.velocity.x).toBe(0);
    expect(rig.state.velocity.z).toBe(0);
    expect(rig.state.position.x).toBeLessThan(3 - 0.35);
  });

  it('only launched characters strike walls; ceilings and slopes slid down are not wall strikes', () => {
    // Running into a wall is not a strike.
    const wall = box(v(1, 0, -5), v(2, 6, 5));
    const runner = onFloor([wall]);
    runner.step(move(1, 0), 40);
    expect(runner.impacts).toEqual([]);
    // Launched into a ceiling: stopped, no strike.
    const ceiling = box(v(-5, 2.5, -5), v(5, 3, 5));
    const rig = onFloor([ceiling]);
    rig.impel({ velocity: v(0, 12, 0), stagger: true });
    rig.step(IDLE_INPUT, 4);
    expect(rig.state.velocity.y).toBeLessThanOrEqual(0);
    expect(rig.impacts.filter((i) => i.kind === 'wall')).toEqual([]);
    // Launched straight down onto a steep slope: blocked by it with nothing closing sideways.
    const steep = rampAt(v(-3, 0, -3), 70, 6, 6);
    const slope = new Rig([FLOOR, steep], v(-2, 8, 0));
    slope.impel({ velocity: v(0, -1, 0), stagger: true });
    slope.step(IDLE_INPUT, 45);
    expect(slope.state.position.x).toBeLessThan(-2.1); // it slid down the slope
    expect(slope.impacts.filter((i) => i.kind === 'wall')).toEqual([]);
  });

  it('every landing reports its speed at contact from the drop, whatever the tick split: a jump lands as fast as it left', () => {
    const rig = onFloor();
    const jump = { pressed: true, held: true };
    rig.step(move(0, 0, { actions: { ...IDLE_INPUT.actions, jump } }));
    while (!rig.step().grounded);
    expect(rig.impacts).toHaveLength(1);
    expect(rig.impacts[0]?.speed).toBeCloseTo(params.jumpSpeed, 9);
    expect(rig.impacts[0]?.height).toBeCloseTo(TUNING.jumpApex, 9);
    expect(rig.impacts[0]?.launch).toBeNull();
    // A drop from rest: 9 m lands at √(2·25·9).
    const drop = new Rig([FLOOR], v(0, 9 + SKIN, 0));
    while (!drop.step().grounded);
    expect(drop.impacts[0]?.speed).toBeCloseTo(Math.sqrt(2 * 25 * 9), 9);
    expect(drop.impacts[0]?.height).toBeCloseTo(9, 9);
    // Terminal speed caps it.
    const high = new Rig([FLOOR], v(0, 60, 0));
    while (!high.step().grounded);
    expect(high.impacts[0]?.speed).toBe(TUNING.maxFallSpeed);
  });

  it('stepCharacter is the state of stepCharacterWithImpacts', () => {
    const rig = onFloor();
    rig.impel({ velocity: v(1, 3, 0) });
    const context = { world: rig.world, tuning: TUNING, params };
    expect(stepCharacter(rig.state, IDLE_INPUT, context)).toEqual(
      stepCharacterWithImpacts(rig.state, IDLE_INPUT, context).state,
    );
  });
});

describe('impulses in the world (mw-e02.15)', () => {
  function world() {
    const w = installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
    w.register(CharacterController);
    w.addSystem(stimulusSystem());
    w.addSystem(
      characterControllerSystem({
        collision: new FakeCollisionWorld([FLOOR]),
        tuning: TUNING,
        input: () => undefined,
      }),
    );
    const impacts: CharacterImpactInfo[] = [];
    w.events.on(CharacterImpacted, (e) => impacts.push(e));
    const off = installCharacterImpulses(w);
    return { w, impacts, off };
  }

  it('applyCharacterImpulse does nothing to an entity without a controller', () => {
    const { w } = world();
    expect(applyCharacterImpulse(w, w.spawn(), { velocity: v(1, 0, 0) })).toBe(false);
  });

  it('a force stimulus launches a pushable character: staggering from others, free when self-cast', () => {
    const { w, impacts, off } = world();
    const caster = w.spawn();
    const target = spawnCharacter(w, v(0, SKIN, 0));
    const self = spawnCharacter(w, v(10, SKIN, 0));
    const inert = spawnCharacter(w, v(20, SKIN, 0));
    addProperties(w, target, { pushable: true, weight: 80 });
    addProperties(w, self, { pushable: true, weight: 80 });
    w.step();
    const gust = (target: number, source: number) =>
      applyStimulus(w, {
        shape: { kind: 'contact', target },
        element: 'force',
        intensity: 800,
        direction: v(0, 1, 0),
        source,
      });
    gust(target, caster);
    gust(self, self);
    gust(inert, caster); // not pushable: the stimulus does not reach it
    w.step();
    expect(w.get(target, CharacterController)?.launch).toEqual({ source: caster, stagger: true });
    expect(w.get(self, CharacterController)?.launch).toEqual({ source: self, stagger: false });
    expect(w.get(inert, CharacterController)?.launch).toBeUndefined();
    for (let i = 0; i < 60; i++) w.step();
    expect(impacts.map((e) => [e.entity, e.kind, e.launch])).toEqual([
      [target, 'ground', { source: caster, stagger: true }],
      [self, 'ground', { source: self, stagger: false }],
    ]);
    expect(impacts[0]?.speed).toBeCloseTo(10, 0);
    expect(impacts[0]?.position.y).toBeCloseTo(SKIN, 6);
    off();
    gust(target, caster);
    for (let i = 0; i < 30; i++) w.step();
    expect(w.get(target, CharacterController)?.launch).toBeUndefined();
    expect(w.get(target, CharacterController)?.grounded).toBe(true);
  });
});
