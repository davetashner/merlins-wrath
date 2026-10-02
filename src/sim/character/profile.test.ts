import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SimClock } from '../clock';
import { World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import {
  capsuleOf,
  controllerParams,
  DEFAULT_STEALTH_TUNING,
  IDLE_INPUT,
  initialCharacterState,
  stepCharacter,
  type CharacterInput,
  type CharacterState,
} from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box, type GreyboxShape } from './greybox';
import {
  CharacterEncumbrance,
  movementGait,
  movementProfile,
  movementProfileOf,
  type MovementProfile,
} from './profile';
import { CharacterController, CharacterTuning } from './system';

/** The mw-e02.2 starting numbers with the mw-e02.10 stealth defaults stated. */
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
  stealth: DEFAULT_STEALTH_TUNING,
};

const params = controllerParams(TUNING, new SimClock(60));
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const FLOOR = box(v(-50, -1, -50), v(50, 0, 50));
/** A ceiling 1.2 m above the floor from x = 1 to x = 6: room to crouch under, not to stand. */
const CEILING = box(v(1, 1.2, -5), v(6, 3, 5));

interface Hold {
  move?: [number, number];
  sprint?: boolean;
  crouch?: boolean;
  slowWalk?: boolean;
}

/** A tick's input; yaw π/2 turns forward input towards +x. */
function input({ move = [0, 0], sprint = false, crouch = false, slowWalk }: Hold): CharacterInput {
  const up = { pressed: false, held: false };
  return {
    actions: {
      move: { x: move[0], y: move[1] },
      jump: up,
      sprint: { pressed: sprint, held: sprint },
      crouch: { pressed: false, held: crouch },
      ...(slowWalk !== undefined && { slowWalk: { pressed: false, held: slowWalk } }),
    },
    cameraYaw: -Math.PI / 2,
  };
}

/** A character on the floor (with `extra` shapes) that steps with TUNING. */
function rig(feet = v(0, 0, 0), extra: readonly GreyboxShape[] = []) {
  const world = new FakeCollisionWorld([FLOOR, ...extra]);
  let state: CharacterState = initialCharacterState(feet);
  const step = (tick: CharacterInput = IDLE_INPUT, ticks = 1) => {
    for (let i = 0; i < ticks; i++)
      state = stepCharacter(state, tick, { world, tuning: TUNING, params });
    return state;
  };
  step(IDLE_INPUT, 3);
  return { step, profile: (encumbrance?: number) => movementProfile(state, TUNING, encumbrance) };
}

const hspeed = (s: CharacterState) => Math.sqrt(s.velocity.x ** 2 + s.velocity.z ** 2);

describe('movement profiles (mw-e02.10)', () => {
  it('AC-1: a crouched player at crouch speed makes 0.15 noise with the crouch capsule’s silhouette', () => {
    const r = rig();
    const state = r.step(input({ move: [0, 1], crouch: true }), 30);
    expect(hspeed(state)).toBeCloseTo(2.2, 9);
    const profile = r.profile();
    expect(profile).toEqual<MovementProfile>({
      stance: 'crouched',
      gait: 'walk',
      silhouetteHeight: 1.0,
      noise: 0.15,
      visibility: 0.45,
    });
    expect(profile.silhouetteHeight).toBe(capsuleOf(state, TUNING).height);
    // Faster crouching (the thief's 2.6 m/s, above runFrom) is still a crouch walk.
    const fast = { ...state, velocity: v(2.6, 0, 0) };
    expect(movementGait(fast, TUNING)).toBe('walk');
  });

  it('AC-2: sprint pressed while crouched stands the player up into a stand-sprint profile', () => {
    const r = rig();
    r.step(input({ move: [0, 1], crouch: true }), 30);
    expect(r.profile()).toMatchObject({ stance: 'crouched', gait: 'walk' });
    const state = r.step(input({ move: [0, 1], crouch: true, sprint: true }));
    expect(state).toMatchObject({ crouched: false, sprinting: true });
    expect(r.profile()).toEqual<MovementProfile>({
      stance: 'standing',
      gait: 'sprint',
      silhouetteHeight: 1.8,
      noise: 1,
      visibility: 1,
    });
    r.step(input({ move: [0, 1], crouch: true, sprint: true }), 30);
    expect(hspeed(r.step())).toBeGreaterThan(5);
  });

  it('AC-2 (edge): under a ceiling too low to stand, sprint while crouched is ignored', () => {
    const r = rig(v(2, 0, 0), [CEILING]);
    r.step(input({ move: [0, 1], crouch: true }), 10);
    const state = r.step(input({ move: [0, 1], crouch: true, sprint: true }), 20);
    expect(state.position.x).toBeLessThan(6);
    expect(state).toMatchObject({ crouched: true, sprinting: false });
    expect(hspeed(state)).toBeCloseTo(2.2, 9);
    expect(r.profile()).toMatchObject({ stance: 'crouched', gait: 'walk', silhouetteHeight: 1.0 });
    // Out from under it, the held sprint stands the player up.
    const out = r.step(input({ move: [0, 1], crouch: true, sprint: true }), 120);
    expect(out.position.x).toBeGreaterThan(6.35);
    expect(r.profile()).toMatchObject({ stance: 'standing', gait: 'sprint' });
  });

  it('AC-3: an encumbrance multiplier of 1.5 makes walking 0.45 noise, clamped to 1.0 overall', () => {
    const r = rig();
    r.step(input({ move: [0, 0.4] }), 30); // 2.0 m/s: a walk
    expect(r.profile()).toMatchObject({ gait: 'walk', noise: 0.3 });
    expect(r.profile(1.5).noise).toBeCloseTo(0.45, 12);
    expect(r.profile(1.5).visibility).toBe(r.profile().visibility); // armor never changes sight
    r.step(input({ move: [0, 1], sprint: true }), 40);
    expect(r.profile(1.5)).toMatchObject({ gait: 'sprint', noise: 1 });
    r.step(input({ move: [0, 1] }), 40);
    expect(r.profile(1.8)).toMatchObject({ gait: 'run', noise: 1 }); // 0.6 × 1.8 = 1.08
    expect(() => r.profile(0)).toThrow(RangeError);
    expect(() => r.profile(Number.NaN)).toThrow(RangeError);
    expect(() => r.profile(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('the slow-walk modifier caps the speed and gives the quietest moving gait, standing or crouched', () => {
    const r = rig();
    const state = r.step(input({ move: [0, 1], slowWalk: true }), 30);
    expect(hspeed(state)).toBeCloseTo(1.2, 9);
    expect(state.slowWalk).toBe(true);
    expect(r.profile()).toMatchObject({ stance: 'standing', gait: 'slowWalk', noise: 0.08 });
    r.step(input({ move: [0, 1], slowWalk: true, crouch: true }), 30);
    expect(r.profile()).toMatchObject({ stance: 'crouched', gait: 'slowWalk', noise: 0.05 });
    // Sprint wins over the modifier; released, the character runs.
    r.step(input({ move: [0, 1], slowWalk: true, sprint: true }), 40);
    expect(r.profile()).toMatchObject({ gait: 'sprint' });
    const run = r.step(input({ move: [0, 1], slowWalk: false }), 40);
    expect(run.slowWalk).toBeUndefined();
    expect(r.profile()).toMatchObject({ gait: 'run', noise: 0.6 });
  });

  it('a light stick (30% deflection or less) is a slow walk at its own speed', () => {
    const r = rig();
    const state = r.step(input({ move: [0, 0.3] }), 30);
    expect(hspeed(state)).toBeCloseTo(1.5, 9);
    expect(r.profile()).toMatchObject({ gait: 'slowWalk', noise: 0.08 });
    r.step(input({ move: [0, 0.31] }), 30);
    expect(r.profile()).toMatchObject({ gait: 'walk' });
  });

  it('standing still (or slower than walkFrom) is the still gait, silent', () => {
    const r = rig();
    expect(r.profile()).toEqual<MovementProfile>({
      stance: 'standing',
      gait: 'still',
      silhouetteHeight: 1.8,
      noise: 0,
      visibility: 0.8,
    });
    r.step(input({ crouch: true }));
    expect(r.profile()).toMatchObject({ stance: 'crouched', gait: 'still', noise: 0 });
  });

  it('a profile without a stealth block reads the sim’s defaults; gait thresholds come from its gait tuning', () => {
    const state = { ...initialCharacterState(v(0, 0, 0)), velocity: v(0.5, 0, 0) };
    const bare: Frozen<ControllerTuning> = { ...TUNING, stealth: undefined };
    expect(movementProfile(state, bare)).toMatchObject({ gait: 'walk', noise: 0.3 });
    const gait = {
      walkFrom: 1,
      runFrom: 3,
      landingMs: 150,
      hardLanding: 6,
      footstep: { walk: 0.7, run: 1, sprint: 1.25, crouch: 0.5 },
    };
    expect(movementGait(state, { ...bare, gait })).toBe('still');
  });
});

describe('movementProfileOf', () => {
  it('reads the controller, the character’s own tuning (else the fallback) and its encumbrance', () => {
    const world = new World<never>({ seed: 1 }).register(CharacterController);
    const id = world.spawn();
    expect(movementProfileOf(world, id, TUNING)).toBeUndefined(); // no controller
    const moving = { ...initialCharacterState(v(0, 0, 0)), velocity: v(2, 0, 0), grounded: true };
    world.add(id, CharacterController, moving);
    expect(movementProfileOf(world, id)).toBeUndefined(); // no tuning to read
    expect(movementProfileOf(world, id, TUNING)).toMatchObject({ gait: 'walk', noise: 0.3 });

    world.register(CharacterTuning, CharacterEncumbrance);
    expect(movementProfileOf(world, id)).toBeUndefined();
    expect(movementProfileOf(world, id, TUNING)?.noise).toBe(0.3); // no encumbrance: ×1
    const quiet = {
      ...TUNING,
      stealth: {
        ...DEFAULT_STEALTH_TUNING,
        profiles: {
          ...DEFAULT_STEALTH_TUNING.profiles,
          standing: {
            ...DEFAULT_STEALTH_TUNING.profiles.standing,
            walk: { noise: 0.2, visibility: 0.7 },
          },
        },
      },
    };
    world.add(id, CharacterTuning, quiet);
    expect(movementProfileOf(world, id, TUNING)).toMatchObject({ noise: 0.2, visibility: 0.7 });
    world.add(id, CharacterEncumbrance, { noise: 1.5 });
    expect(movementProfileOf(world, id)?.noise).toBeCloseTo(0.3, 12);
  });
});
