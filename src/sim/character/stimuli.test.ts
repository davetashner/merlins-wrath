import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { readProperty, registerWorldProperties } from '../properties/components';
import { hashWorld } from '../snapshot';
import { PlacementCentreComponent, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { DEFAULT_LAUNCH_TUNING, IDLE_INPUT, SKIN, type CharacterInput } from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box } from './greybox';
import { characterCentre, installCharacterStimuli, makePushable } from './stimuli';
import { CharacterController, characterControllerSystem, spawnCharacter } from './system';

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
  launch: { airControl: 0.1, recoveryMs: 250, mass: 90 },
};

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A world with stimuli, a floor and characters as stimulus targets; `crouch` holds crouch. */
function arena(crouch = false) {
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 5 })));
  world.register(CharacterController);
  world.addSystem(stimulusSystem());
  const held: CharacterInput | undefined = crouch
    ? {
        ...IDLE_INPUT,
        actions: { ...IDLE_INPUT.actions, crouch: { held: true, pressed: true } },
      }
    : undefined;
  world.addSystem(
    characterControllerSystem({
      collision: new FakeCollisionWorld([box(v(-50, -1, -50), v(50, 0, 50))]),
      tuning: TUNING,
      input: () => held,
    }),
  );
  installCharacterStimuli(world, TUNING);
  return world;
}

describe('characters as stimulus targets (mw-e04.34)', () => {
  it('the capsule’s bounding sphere is the placement centre, standing or crouched', () => {
    expect(characterCentre(TUNING.capsule, false)).toEqual({
      offset: { x: 0, y: 0.9, z: 0 },
      radius: 0.9,
    });
    expect(characterCentre(TUNING.capsule, true)).toEqual({
      offset: { x: 0, y: 0.5, z: 0 },
      radius: 0.5,
    });
  });

  it('keeps every character’s placement at its feet and its centre on its capsule', () => {
    const world = arena();
    const a = spawnCharacter(world, v(0, SKIN, 0));
    const b = spawnCharacter(world, v(5, 3, 0));
    world.step();
    world.step();
    for (const entity of [a, b]) {
      const feet = world.get(entity, CharacterController)?.position;
      expect(placementOf(world, entity)).toEqual({ ...feet, radius: 0.35 });
      expect(world.get(entity, PlacementCentreComponent)?.radius).toBe(0.9);
    }
    const crouched = arena(true);
    const c = spawnCharacter(crouched, v(0, SKIN, 0));
    for (let i = 0; i < 3; i++) crouched.step();
    expect(crouched.get(c, CharacterController)?.crouched).toBe(true);
    expect(crouched.get(c, PlacementCentreComponent)?.radius).toBe(0.5);
  });

  it('AC-1: a sphere force stimulus at a character’s side launches it up and away, deterministically', () => {
    const run = () => {
      const world = arena();
      const knight = spawnCharacter(world, v(0, SKIN, 0));
      makePushable(world, knight, TUNING);
      world.step();
      world.step();
      applyStimulus(world, {
        shape: { kind: 'sphere', center: v(-1, 0, 0), radius: 4 },
        element: 'force',
        intensity: 1500,
      });
      world.step();
      return { world, knight };
    };
    const { world, knight } = run();
    const state = world.get(knight, CharacterController);
    expect(state?.grounded).toBe(false);
    expect(state?.launch).toEqual({ source: null, stagger: true });
    expect(state?.velocity.x).toBeGreaterThan(5);
    expect(state?.velocity.y).toBeGreaterThan(2);
    expect(hashWorld(run().world)).toBe(hashWorld(world));
  });

  it('makePushable gives the launch.mass as weight, or the sim default without a launch block', () => {
    const world = arena();
    const knight = spawnCharacter(world, v(0, SKIN, 0));
    makePushable(world, knight, TUNING);
    const bare: Frozen<ControllerTuning> = { ...TUNING, launch: undefined };
    const other = spawnCharacter(world, v(3, SKIN, 0));
    makePushable(world, other, bare);
    world.step();
    expect(readProperty(world, knight, 'pushable')).toBe(true);
    expect(readProperty(world, knight, 'weight')).toBe(90);
    expect(readProperty(world, other, 'weight')).toBe(DEFAULT_LAUNCH_TUNING.mass);
  });
});
