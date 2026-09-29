import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SimClock } from '../clock';
import type { Vec3 } from '../stimulus/shapes';
import type { CollisionHit, CollisionWorld } from './collision-world';
import {
  capsuleOf,
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  movementState,
  SKIN,
  stepCharacter,
  type CharacterInput,
  type CharacterState,
} from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box, radians, rampAt, type GreyboxShape } from './greybox';
import { tan } from '../math';
import { TRAVERSAL_MODES, type TraversalHook } from './traversal';

/** The mw-e02.2 starting numbers (the shipped file is checked in tests/contracts). */
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

const HZ = 60;
const params = controllerParams(TUNING, new SimClock(HZ));
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** `value`, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
const FLOOR = box(v(-50, -1, -50), v(50, 0, 50));

interface Hold {
  move?: [number, number];
  jump?: 'press' | 'hold';
  sprint?: boolean;
  crouch?: boolean;
  yaw?: number;
}

/** A tick's input: `move` [x right, y forward], buttons pressed or held. */
function input({ move = [0, 0], jump, sprint = false, crouch = false, yaw = 0 }: Hold = {}) {
  const up = { pressed: false, held: false };
  return {
    actions: {
      move: { x: move[0], y: move[1] },
      jump: jump === undefined ? up : { pressed: jump === 'press', held: true },
      sprint: { pressed: false, held: sprint },
      crouch: { pressed: false, held: crouch },
    },
    cameraYaw: yaw,
  } satisfies CharacterInput;
}

const EAST = input({ move: [1, 0] });
const hspeed = (s: CharacterState) => Math.sqrt(s.velocity.x ** 2 + s.velocity.z ** 2);

/** A character in a fake world; moving colliders advance before the character each tick. */
class Rig {
  readonly world: FakeCollisionWorld;
  state: CharacterState;
  readonly trace: CharacterState[] = [];

  constructor(
    shapes: readonly GreyboxShape[],
    feet: Vec3,
    private readonly hooks: readonly TraversalHook[] = [],
    private readonly collision?: CollisionWorld,
  ) {
    this.world = new FakeCollisionWorld(shapes);
    this.state = initialCharacterState(feet);
  }

  step(tickInput: CharacterInput = IDLE_INPUT, ticks = 1): CharacterState {
    for (let i = 0; i < ticks; i++) {
      this.world.advance(params.dt);
      this.state = stepCharacter(this.state, tickInput, {
        world: this.collision ?? this.world,
        tuning: TUNING,
        params,
        hooks: this.hooks,
      });
      this.trace.push(this.state);
    }
    return this.state;
  }

  /** Steps until `done` holds (at most `limit` ticks); returns the ticks taken. */
  until(tickInput: CharacterInput, done: (s: CharacterState) => boolean, limit = 600): number {
    for (let n = 1; n <= limit; n++) {
      if (done(this.step(tickInput))) return n;
    }
    throw new Error('condition never met');
  }
}

/** A rig standing at rest on a flat floor. */
function onFloor(feet = v(0, 0, 0), extra: readonly GreyboxShape[] = []): Rig {
  const rig = new Rig([FLOOR, ...extra], feet);
  rig.step(IDLE_INPUT, 3);
  expect(rig.state.grounded).toBe(true);
  return rig;
}

describe('controller params', () => {
  it('derives per-tick constants from tuning and the tick rate', () => {
    expect(params).toEqual({
      dt: 1 / 60,
      jumpSpeed: Math.sqrt(60),
      minGroundY: expect.closeTo(Math.SQRT1_2, 12) as number,
      coyoteTicks: 7,
      jumpBufferTicks: 9,
      accel: 5 / 0.15,
      decel: 5 / 0.1,
    });
  });
});

describe('ground movement', () => {
  it('AC-1: reaches 5.0 m/s ± 0.05 within 0.15 s of holding forward and stops within 0.10 s of release', () => {
    const rig = onFloor();
    const forward = input({ move: [0, 1] });
    const ticks = rig.until(forward, (s) => Math.abs(hspeed(s) - 5) <= 0.05);
    expect(ticks / HZ).toBeLessThanOrEqual(0.15);
    rig.step(forward, 30);
    expect(hspeed(rig.state)).toBeCloseTo(5, 9);
    expect(rig.state.velocity.z).toBeLessThan(0); // yaw 0 looks along −z
    const stop = rig.until(IDLE_INPUT, (s) => hspeed(s) === 0);
    expect(stop / HZ).toBeLessThanOrEqual(0.1);
    const at = rig.state.position;
    rig.step(IDLE_INPUT, 10);
    expect(rig.state.position).toEqual(at);
  });

  it('walks at part speed with part deflection and never exceeds full deflection', () => {
    const rig = onFloor();
    rig.step(input({ move: [0, 0.5] }), 30);
    expect(hspeed(rig.state)).toBeCloseTo(2.5, 9);
    rig.step(input({ move: [1, 1] }), 30);
    expect(hspeed(rig.state)).toBeCloseTo(5, 9);
  });

  it('sprints at 7.5 m/s; crouching caps speed at 2.2 m/s and cancels sprint', () => {
    const rig = onFloor();
    rig.step(input({ move: [0, 1], sprint: true }), 40);
    expect(hspeed(rig.state)).toBeCloseTo(7.5, 9);
    expect(movementState(rig.state)).toEqual({
      grounded: true,
      airborne: false,
      crouched: false,
      sprinting: true,
    });
    rig.step(input({ move: [0, 1], sprint: true, crouch: true }), 40);
    expect(hspeed(rig.state)).toBeCloseTo(2.2, 9);
    expect(movementState(rig.state)).toMatchObject({ crouched: true, sprinting: false });
    expect(rig.step(input({ sprint: true })).sprinting).toBe(false); // not moving
  });

  it('moves relative to the camera yaw', () => {
    const rig = onFloor();
    rig.step(input({ move: [0, 1], yaw: Math.PI / 2 }), 30);
    expect(rig.state.velocity.x).toBeCloseTo(-5, 9);
    expect(rig.state.velocity.z).toBeCloseTo(0, 9);
    rig.step(input({ move: [1, 0], yaw: Math.PI }), 30);
    expect(rig.state.velocity.x).toBeCloseTo(-5, 9);
  });

  it('slides along a wall it runs into at an angle, keeping the speed along it', () => {
    const rig = onFloor(v(0, 0, 0), [box(v(1, 0, -20), v(2, 3, 20))]);
    rig.step(input({ move: [1, 1] }), 60);
    expect(rig.state.position.x).toBeCloseTo(1 - 0.35 - SKIN, 6);
    expect(rig.state.velocity.x).toBeCloseTo(0, 9);
    expect(rig.state.velocity.z).toBeLessThan(-3);
  });
});

describe('jumping and falling', () => {
  function jumpArc() {
    const rig = onFloor();
    const start = rig.state.position.y;
    rig.step(input({ jump: 'press' }));
    let apex = rig.state.position.y;
    const landing = rig.until(IDLE_INPUT, (s) => {
      apex = Math.max(apex, s.position.y);
      return s.grounded;
    });
    return { apex: apex - start, landing, end: rig.state.position.y - start };
  }

  it('AC-2: a jump peaks at 1.2 m ± 0.02 and lands on the same tick every run', () => {
    const first = jumpArc();
    expect(first.apex).toBeCloseTo(1.2, 2);
    expect(Math.abs(first.apex - 1.2)).toBeLessThanOrEqual(0.02);
    expect(first.end).toBeCloseTo(0, 9);
    // 2·√(2gh)/g = 0.62 s of flight.
    expect(first.landing + 1).toBe(Math.ceil((2 * Math.sqrt(60)) / 25 / params.dt));
    expect(jumpArc()).toEqual(first);
  });

  it('AC-2: a jump pressed up to 150 ms before landing fires on landing; earlier presses are dropped', () => {
    // Landing tick of an unbuffered jump: the state after step `land` is grounded again.
    const reference = onFloor();
    reference.step(input({ jump: 'press' }));
    const land = reference.until(IDLE_INPUT, (s) => s.grounded);
    const jumpsAgain = (before: number): boolean => {
      const rig = onFloor();
      rig.step(input({ jump: 'press' }));
      for (let t = 1; t <= land; t++) {
        rig.step(t === land + 1 - before ? input({ jump: 'press' }) : IDLE_INPUT);
      }
      expect(rig.state.grounded).toBe(true);
      return rig.step(IDLE_INPUT).velocity.y > 0;
    };
    expect(jumpsAgain(6)).toBe(true); // 100 ms
    expect(jumpsAgain(9)).toBe(true); // 150 ms
    expect(jumpsAgain(10)).toBe(false); // 167 ms
    expect(jumpsAgain(12)).toBe(false); // 200 ms
  });

  it('keeps momentum in the air and steers with only airControl of the acceleration', () => {
    const rig = onFloor();
    rig.step(EAST, 30);
    rig.step(input({ move: [1, 0], jump: 'press' }));
    rig.step(IDLE_INPUT, 5);
    expect(rig.state.velocity.x).toBeCloseTo(5, 9);
    const before = rig.state.velocity.x;
    rig.step(input({ move: [-1, 0] }));
    expect(before - rig.state.velocity.x).toBeCloseTo(params.accel * 0.3 * params.dt, 9);
  });

  it('bumps its head on a low ceiling and loses its upward speed', () => {
    const rig = onFloor(v(0, 0, 0), [box(v(-2, 2.3, -2), v(2, 3, 2))]);
    rig.step(input({ jump: 'press' }));
    let peak = 0;
    rig.until(IDLE_INPUT, (s) => {
      peak = Math.max(peak, s.position.y);
      return s.grounded;
    });
    expect(peak).toBeLessThan(0.5 + SKIN * 2);
    expect(peak).toBeGreaterThan(0.45);
  });

  it('falls no faster than maxFallSpeed', () => {
    const rig = new Rig([FLOOR], v(0, 500, 0));
    rig.step(IDLE_INPUT, 240);
    expect(rig.state.velocity.y).toBe(-40);
    expect(movementState(rig.state).airborne).toBe(true);
  });
});

describe('coyote time', () => {
  /** A 2 m ledge ending at x = 0 over a floor; the character runs east off it. */
  const LEDGE = box(v(-20, 0, -5), v(0, 2, 5));

  function runOffLedge(pressAfter: number): CharacterState {
    const rig = new Rig([FLOOR, LEDGE], v(-3, 2, 0));
    rig.step(IDLE_INPUT, 3);
    const left = rig.until(EAST, (s) => !s.grounded);
    expect(left).toBeGreaterThan(20);
    // The last grounded state was one step ago; press `pressAfter` ticks after it.
    for (let t = 2; t < pressAfter; t++) rig.step(EAST);
    return rig.step(input({ move: [1, 0], jump: 'press' }));
  }

  it('AC-3: jumps when pressed 100 ms after walking off a ledge', () => {
    expect(runOffLedge(6).velocity.y).toBeCloseTo(Math.sqrt(60) - 25 / 60, 9);
  });

  it('AC-3: jumps at the 120 ms limit but not at 130 ms (the first tick past it)', () => {
    expect(runOffLedge(7).velocity.y).toBeGreaterThan(0);
    expect(runOffLedge(8).velocity.y).toBeLessThan(0);
  });

  it('AC-3: gives no coyote jump after a real jump', () => {
    const rig = onFloor();
    rig.step(input({ jump: 'press' }));
    rig.step(IDLE_INPUT, 2);
    const vy = rig.state.velocity.y;
    expect(rig.step(input({ jump: 'press' })).velocity.y).toBeCloseTo(vy - 25 / 60, 9);
  });
});

describe('steps and ground snapping', () => {
  function runAt(stepTop: number) {
    const rig = onFloor(v(-4, 0, 0), [box(v(2, 0, -5), v(6, stepTop, 5))]);
    rig.step(EAST, 20); // up to speed
    const xs: number[] = [];
    for (let i = 0; i < 60; i++) xs.push(rig.step(EAST).position.x);
    const speeds = xs.slice(1).map((x, i) => (x - must(xs[i])) * HZ);
    return { rig, minSpeed: Math.min(...speeds) };
  }

  it('AC-4: walks up a 0.30 m step losing no more than 10% speed', () => {
    const { rig, minSpeed } = runAt(0.3);
    expect(minSpeed).toBeGreaterThanOrEqual(4.5);
    expect(rig.trace.some((s) => s.position.x > 2 && s.grounded && s.position.y > 0.29)).toBe(true);
  });

  it('AC-4: is blocked by a 0.40 m step', () => {
    const { rig } = runAt(0.4);
    expect(rig.state.position.x).toBeCloseTo(2 - 0.35 - SKIN, 6);
    expect(Math.max(...rig.trace.map((s) => s.position.y))).toBeLessThan(0.02);
    expect(hspeed(rig.state)).toBeCloseTo(0, 9);
  });

  it('snaps down a step no taller than stepHeight and stays grounded', () => {
    const rig = onFloor(v(3, 0.3, 0), [box(v(2, 0, -5), v(6, 0.3, 5))]);
    rig.until(EAST, (s) => s.position.x > 7);
    expect(rig.trace.every((s) => s.grounded)).toBe(true);
    expect(rig.state.position.y).toBeCloseTo(SKIN, 9);
  });

  it('cannot step up under a ceiling that leaves no headroom', () => {
    const rig = onFloor(v(0, 0, 0), [
      box(v(2, 0, -5), v(6, 0.2, 5)),
      box(v(-5, 1.8 + SKIN * 1.5, -5), v(6, 3, 5)),
    ]);
    rig.step(EAST, 60);
    expect(rig.state.position.x).toBeCloseTo(2 - 0.35 - SKIN, 6);
  });
});

describe('slopes', () => {
  it('AC-5: slides back down a 50° slope and cannot walk up it', () => {
    const ramp = rampAt(v(2, 0, -3), 50, 3, 6);
    const base = onFloor(v(0, 0, 0), [ramp]);
    base.step(EAST, 180);
    expect(Math.max(...base.trace.map((s) => s.position.y))).toBeLessThan(0.02);
    expect(base.state.position.x).toBeLessThan(2);

    // Dropped onto the slope and still pushing uphill: it slides to the bottom.
    const x = 2 + 1.5 / tan(radians(50));
    const onSlope = new Rig([FLOOR, ramp], v(x, 1.6, 0));
    onSlope.step(EAST, 180);
    const ys = onSlope.trace.map((s) => s.position.y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1.6);
    expect(onSlope.trace.slice(0, 30).some((s) => s.grounded)).toBe(false);
    expect(onSlope.state.position.y).toBeCloseTo(SKIN, 9);
    expect(onSlope.state.grounded).toBe(true);
  });

  it('AC-5: walks up a 40° slope at 80% of run speed or better', () => {
    const ramp = rampAt(v(2, 0, -3), 40, 3, 6);
    const top = box(v(ramp.max.x, 0, -3), v(ramp.max.x + 5, 3, 3));
    const rig = onFloor(v(-3, 0, 0), [ramp, top]);
    rig.until(EAST, (s) => s.position.x > ramp.max.x + 1);
    const onRamp = rig.trace.filter((s) => s.position.y > 0.2 && s.position.y < 2.8);
    expect(onRamp.length).toBeGreaterThan(10);
    expect(onRamp.every((s) => s.grounded && hspeed(s) >= 0.8 * 5)).toBe(true);
    const xs = rig.trace.map((s) => s.position.x);
    const climbing = rig.trace.flatMap((s, i) =>
      i > 0 && s.position.y > 0.2 && s.position.y < 2.8
        ? [(s.position.x - must(xs[i - 1])) * HZ]
        : [],
    );
    expect(Math.min(...climbing)).toBeGreaterThanOrEqual(0.8 * 5);
    expect(rig.state.position.y).toBeCloseTo(3 + SKIN, 6);
  });
});

describe('crouching', () => {
  // A ceiling 1.2 m above the floor from x = 1 to x = 6.
  const CEILING = box(v(1, 1.2, -5), v(6, 3, 5));

  it('AC-6: stays crouched under a 1.2 m ceiling after crouch is released, until it clears', () => {
    const rig = onFloor(v(0, 0, 0), [CEILING]);
    const crouchEast = input({ move: [1, 0], crouch: true });
    rig.until(crouchEast, (s) => s.position.x > 3);
    expect(capsuleOf(rig.state, TUNING)).toEqual({ radius: 0.35, height: 1.0 });
    // Released under the ceiling: still crouched, still at crouch speed.
    rig.step(IDLE_INPUT, 20);
    expect(rig.state.crouched).toBe(true);
    rig.until(EAST, (s) => s.position.x > 6 + 0.35 + 0.1);
    const underneath = rig.trace.filter((s) => s.position.x - 0.35 < 6 && s.position.x > 3);
    expect(underneath.every((s) => s.crouched && hspeed(s) <= 2.2 + 1e-9)).toBe(true);
    expect(rig.state.crouched).toBe(false);
    expect(capsuleOf(rig.state, TUNING)).toEqual({ radius: 0.35, height: 1.8 });
  });

  it('stands straight up when crouch is released in the open', () => {
    const rig = onFloor();
    rig.step(input({ crouch: true }));
    expect(rig.state.crouched).toBe(true);
    expect(rig.step(IDLE_INPUT).crouched).toBe(false);
  });
});

describe('moving platforms', () => {
  it('carries a character standing on a platform moving sideways', () => {
    const platform: GreyboxShape = { ...box(v(-2, 0, -2), v(2, 0.5, 2)), velocity: v(2, 0, 0) };
    const rig = new Rig([FLOOR, platform], v(0, 0.5, 0));
    rig.step(IDLE_INPUT, 3);
    const x = rig.state.position.x;
    rig.step(IDLE_INPUT, 60);
    expect(rig.state.position.x - x).toBeCloseTo(2, 6);
    expect(rig.state.grounded).toBe(true);
    expect(rig.state.groundBody).toBe(2);
  });

  it('rides a platform up and down', () => {
    const lift: GreyboxShape = { ...box(v(-2, 0, -2), v(2, 0.5, 2)), velocity: v(0, 1, 0) };
    const rig = new Rig([FLOOR, lift], v(0, 0.5, 0));
    rig.step(IDLE_INPUT, 3);
    const y = rig.state.position.y;
    rig.step(IDLE_INPUT, 60);
    expect(rig.state.position.y - y).toBeCloseTo(1, 6);
    expect(rig.trace.slice(3).every((s) => s.grounded)).toBe(true);
    rig.world.setVelocity(2, v(0, -1, 0));
    rig.step(IDLE_INPUT, 30);
    expect(rig.state.position.y - y).toBeCloseTo(0.5, 6);
    expect(rig.trace.slice(3).every((s) => s.grounded)).toBe(true);
  });

  it('carries nothing when the ground collider is unknown', () => {
    const rig = onFloor();
    const state = { ...rig.state, groundBody: null };
    const next = stepCharacter(state, IDLE_INPUT, { world: rig.world, tuning: TUNING, params });
    expect(next.position).toEqual(state.position);
  });
});

describe('traversal hooks', () => {
  const climb = (enter: boolean): TraversalHook & { entered: number } => ({
    mode: 'climb',
    entered: 0,
    shouldEnter() {
      return enter;
    },
    step(ctx) {
      this.entered++;
      return { ...ctx.state, traversal: ctx.input.actions.crouch.held ? null : 'climb' };
    },
  });

  it('offers climb, mantle and swim as traversal modes', () => {
    expect(TRAVERSAL_MODES).toEqual(['climb', 'mantle', 'swim']);
  });

  it('runs locomotion while no hook wants the character', () => {
    const hook = climb(false);
    const rig = new Rig([FLOOR], v(0, 0, 0), [hook]);
    rig.step(EAST, 5);
    expect(hook.entered).toBe(0);
    expect(rig.state.position.x).toBeGreaterThan(0);
  });

  it('hands the character to a hook until it hands back', () => {
    const hook = climb(true);
    const rig = new Rig([FLOOR], v(0, 0, 0), [hook]);
    rig.step(EAST, 3);
    expect(hook.entered).toBe(3);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.position).toEqual(v(0, 0, 0));
    rig.step(input({ crouch: true }));
    expect(rig.state.traversal).toBeNull();
  });

  it('falls back to locomotion when the active mode has no hook', () => {
    const rig = new Rig([FLOOR], v(0, 0, 0));
    rig.state = { ...rig.state, traversal: 'swim' };
    expect(rig.step(IDLE_INPUT).traversal).toBeNull();
  });
});

describe('degenerate collision replies', () => {
  /** A world answering sweeps from a script (then nothing), for replies real geometry never gives. */
  function scripted(replies: (CollisionHit | undefined)[]): CollisionWorld {
    return {
      sweepCapsule: () => replies.shift(),
      raycast: () => undefined,
      overlapCapsule: () => false,
      bodyVelocity: () => v(0, 0, 0),
    };
  }
  const hit = (normal: Vec3): CollisionHit => ({ distance: 0, normal, point: v(0, 0, 0), body: 1 });
  const uphill = {
    ...initialCharacterState(v(0, 0, 0)),
    grounded: true,
    groundNormal: v(-0.6, 0.8, 0),
    groundBody: 1,
  };

  it('treats a wall with nowhere to land beyond as a wall', () => {
    const world = scripted([hit(v(-1, 0, 0)), undefined, undefined, undefined]);
    const next = stepCharacter({ ...uphill, velocity: v(5, 0, 0) }, EAST, {
      world,
      tuning: TUNING,
      params,
    });
    expect(next.velocity.x).toBe(0);
  });

  it('does not try to step while only moving vertically', () => {
    const world = scripted([hit(v(-1, 0, 0)), undefined, hit(v(-1, 0, 0)), hit(v(0, 0, 1))]);
    const next = stepCharacter({ ...uphill, velocity: v(5, 0, 0) }, EAST, {
      world,
      tuning: TUNING,
      params,
    });
    expect(next.velocity.x).toBe(0);
    expect(next.position.x).toBe(0);
  });
});
