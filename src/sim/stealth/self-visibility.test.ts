import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STEALTH_TUNING, initialCharacterState } from '../character/controller';
import { CharacterController, CharacterTuning } from '../character/system';
import { World } from '../core/world';
import { LightField } from '../light/field';
import type { Vec3 } from '../stimulus/shapes';
import { bodyLightSamples, selfVisibilityOf, VisibilityProfileComponent } from './self-visibility';
import { DEFAULT_VISIBILITY_TUNING, lightTerm } from './visibility';

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

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Light that rises with height: level = y / 2 (so the head is brighter than the feet). */
const rising = { levelAt: (p: Vec3) => Math.min(1, p.y / 2) };

describe('selfVisibilityOf (mw-e09.2)', () => {
  it('samples the light field at the character’s body points and its stance and speed', () => {
    const world = new World<never>({ seed: 1 }).register(CharacterController);
    const id = world.spawn();
    const light = new LightField();
    light.setEnvironment({
      ambient: 0.05,
      ambientZones: [{ id: 'yard', min: v(5, -1, -5), max: v(15, 10, 5), level: 0.9 }],
    });

    expect(selfVisibilityOf(world, light, id, { fallback: TUNING })).toBeUndefined();
    world.add(id, CharacterController, { ...initialCharacterState(v(0, 0, 0)), crouched: true });
    expect(selfVisibilityOf(world, light, id)).toBeUndefined(); // no controller tuning

    // Crouched and still in 0.05 ambient: well under the HUD's lowest band.
    const hidden = selfVisibilityOf(world, light, id, { fallback: TUNING });
    expect(hidden).toMatchObject({ level: 0.05, stance: 0.5, motion: 0.8, profile: 1 });
    expect(hidden?.value).toBeLessThan(0.05);

    // Sprinting upright through the moonlit yard: nearly fully exposed.
    world.add(id, CharacterController, {
      ...initialCharacterState(v(10, 0, 0)),
      velocity: v(7.5, -3, 0),
    });
    const exposed = selfVisibilityOf(world, light, id, { fallback: TUNING });
    expect(exposed).toMatchObject({ level: 0.9, stance: 1, motion: 1 });
    expect(exposed?.value).toBeCloseTo(lightTerm(0.9, 0, DEFAULT_VISIBILITY_TUNING), 12);
  });

  it('reads the character’s own tuning, a visibility profile and a tuning override', () => {
    const world = new World<never>({ seed: 1 }).register(CharacterController, CharacterTuning);
    const id = world.spawn();
    world.add(id, CharacterController, initialCharacterState(v(0, 0, 0)));
    world.add(id, CharacterTuning, TUNING);
    const plain = selfVisibilityOf(world, rising, id);
    expect(plain?.profile).toBe(1);

    world.register(VisibilityProfileComponent);
    expect(selfVisibilityOf(world, rising, id)?.profile).toBe(1); // registered, none worn
    world.add(id, VisibilityProfileComponent, { cloaked: true });
    expect(selfVisibilityOf(world, rising, id)?.profile).toBe(0.7);

    const tuning = { ...DEFAULT_VISIBILITY_TUNING, profile: { cloak: 0.5, disguise: 1 } };
    expect(selfVisibilityOf(world, rising, id, { tuning })?.profile).toBe(0.5);
  });

  it('crouching lowers the sample points into the darker air near the floor', () => {
    const feet = v(0, 0, 0);
    const close = (got: number[], want: number[]) => {
      expect(got).toHaveLength(want.length);
      got.forEach((n, i) => {
        expect(n).toBeCloseTo(want[i] ?? Number.NaN, 12);
      });
    };
    close(bodyLightSamples(rising, feet, 1.8), [0.855, 0.648, 0.45, 0.045]);
    close(bodyLightSamples(rising, feet, 1.0), [0.475, 0.36, 0.25, 0.025]);
    expect(bodyLightSamples(rising, v(0, 1, 0), 1, [0, 1])).toEqual([0.5, 1]);

    const world = new World<never>({ seed: 1 }).register(CharacterController);
    const id = world.spawn();
    world.add(id, CharacterController, initialCharacterState(feet));
    const standing = selfVisibilityOf(world, rising, id, { fallback: TUNING });
    world.add(id, CharacterController, { ...initialCharacterState(feet), crouched: true });
    const crouched = selfVisibilityOf(world, rising, id, { fallback: TUNING });
    expect(crouched?.level).toBeLessThan(standing?.level ?? 0);
  });
});
