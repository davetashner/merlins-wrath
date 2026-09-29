import { describe, expect, it } from 'vitest';
import { box, rampAt } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addProperties,
  assignProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  applyStimulus,
  installStimuli,
  stimulusSystem,
  type StimulusResolution,
} from '../stimulus/stimulus';
import { setLightCone, setLightOccluderBox } from './components';
import {
  DEFAULT_LIGHT_CONFIG,
  LightField,
  resolveLightConfig,
  type LightConfig,
  type LightEnvironment,
} from './field';
import { installLightField, lightFieldSystem } from './install';

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A world with properties, stimuli and a light field, systems in the documented order. */
function lightWorld(config: Partial<LightConfig> = {}) {
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3 })));
  const field = new LightField(config);
  installLightField(world, field);
  world.addSystem(stimulusSystem()).addSystem(lightFieldSystem(field));
  return { world, field };
}

/** Spawns a placed entity with `props`. */
function thing(world: World<never>, where: Vec3, props: WorldPropertyInit, radius = 0): EntityId {
  const entity = world.spawn();
  placeEntity(world, entity, where, radius);
  addProperties(world, entity, props);
  return entity;
}

const lamp = (world: World<never>, where: Vec3, intensity: number, radius: number): EntityId =>
  thing(world, where, { lightEmitter: { intensity, radius } });

/** Walls of a 10 × 10 m room (x, z in −5…5, 3 m high) with a 1 m doorway at x −0.5…0.5, z = 5. */
function room(field: LightField): void {
  field.statics.add(box(at(-5, -0.2, -5), at(5, 0, 5))); // floor
  field.statics.add(box(at(-5.2, 0, -5.2), at(5.2, 3, -5))); // back wall
  field.statics.add(box(at(-5.2, 0, -5), at(-5, 3, 5))); // left wall
  field.statics.add(box(at(5, 0, -5), at(5.2, 3, 5))); // right wall
  field.statics.add(box(at(-5.2, 0, 5), at(-0.5, 3, 5.2))); // front wall, left of the door
  field.statics.add(box(at(0.5, 0, 5), at(5.2, 3, 5.2))); // front wall, right of the door
}

describe('light config', () => {
  it('fills defaults and validates every field', () => {
    expect(resolveLightConfig()).toEqual(DEFAULT_LIGHT_CONFIG);
    expect(resolveLightConfig({ defaultAmbient: 0.1 }).defaultAmbient).toBe(0.1);
    const bad: Partial<LightConfig>[] = [
      { fullIntensity: 0 },
      { fullIntensity: Infinity },
      { fireLight: { intensity: -1, radius: 8 } },
      { fireLight: { intensity: 1, radius: NaN } },
      { fireLight: { intensity: Infinity, radius: 1 } },
      { fireLight: { intensity: 1, radius: -1 } },
      { defaultAmbient: 1.5 },
      { defaultAmbient: -0.1 },
    ];
    for (const input of bad) {
      expect(() => resolveLightConfig(input), JSON.stringify(input)).toThrow(RangeError);
    }
  });
});

describe('light field sampling', () => {
  it('AC-1: a point light of intensity 1.0 and radius 8 m gives 1.0, 0.25 and 0.0 at 0, 4 and 8 m', () => {
    const { world, field } = lightWorld({ fullIntensity: 1 });
    const light = lamp(world, at(0, 1, 0), 1, 8);
    world.step();
    expect(field.levelAt(at(0, 1, 0))).toBe(1);
    expect(field.levelAt(at(4, 1, 0))).toBeCloseTo(0.25, 2);
    expect(Math.abs(field.levelAt(at(0, 1, 4)) - 0.25)).toBeLessThanOrEqual(0.01);
    expect(field.levelAt(at(0, 9, 0))).toBe(0);
    expect(field.levelAt(at(8, 1, 0))).toBe(0);
    const sample = field.sample(at(4, 1, 0));
    expect(sample).toEqual({
      level: 0.25,
      ambient: 0,
      zone: null,
      contributions: [{ source: { kind: 'emitter', entity: light }, level: 0.25 }],
    });
  });

  it('AC-1: with the default scale a torch (intensity 100) follows the same falloff', () => {
    const { world, field } = lightWorld();
    lamp(world, at(0, 1, 0), 100, 8);
    lamp(world, at(40, 1, 0), 50, 8);
    world.step();
    expect(field.levelAt(at(0, 1, 0))).toBe(1);
    expect(field.levelAt(at(0, 1, 4))).toBe(0.25);
    expect(field.levelAt(at(40, 1, 4))).toBe(0.125);
    expect(field.emitterCount).toBe(2);
  });

  it('sums contributions over ambient and clamps the level at 1', () => {
    const { world, field } = lightWorld({ defaultAmbient: 0.1 });
    const a = lamp(world, at(-4, 1, 0), 100, 8);
    const b = lamp(world, at(4, 1, 0), 100, 8);
    world.step();
    const middle = field.sample(at(0, 1, 0));
    expect(middle.ambient).toBe(0.1);
    expect(middle.contributions.map((c) => c.source)).toEqual([
      { kind: 'emitter', entity: a },
      { kind: 'emitter', entity: b },
    ]);
    expect(middle.level).toBeCloseTo(0.1 + 2 * 0.5 ** 2, 12);
    expect(field.levelAt(at(-4, 1, 0))).toBe(1); // 0.1 + 1 + a little of b, clamped
    expect(field.levelAt(at(100, 1, 0))).toBe(0.1);
  });

  it('ignores emitters of zero intensity or zero radius', () => {
    const { world, field } = lightWorld();
    lamp(world, at(0, 1, 0), 0, 8);
    lamp(world, at(0, 1, 0), 100, 0);
    world.step();
    expect(field.emitterCount).toBe(0);
    expect(field.sample(at(0, 1, 0)).contributions).toEqual([]);
  });

  it('AC-2: a wall between an emitter and the sample point stops its contribution', () => {
    const { world, field } = lightWorld();
    const light = lamp(world, at(0, 1.5, 0), 100, 8);
    lamp(world, at(0, 1.5, -20), 100, 8); // out of range: never contributes
    field.statics.add(box(at(2, 0, -3), at(2.2, 3, 3)));
    world.step();
    expect(field.levelAt(at(1.9, 1.5, 0))).toBeGreaterThan(0);
    const behind = field.sample(at(3, 1.5, 0));
    expect(behind.level).toBe(0);
    expect(behind.contributions).toEqual([]);
    // Past the wall's end the light gets round it again; samples reuse the baked cells.
    expect(field.levelAt(at(3, 1.5, 6))).toBeGreaterThan(0);
    expect(field.levelAt(at(3.2, 1.5, 0.3))).toBe(0);
    expect(field.sample(at(1, 1.5, 1)).contributions[0]?.source).toEqual({
      kind: 'emitter',
      entity: light,
    });
  });

  it('AC-2: a sample on a wall face or the floor is lit; one inside solid geometry is not', () => {
    const { world, field } = lightWorld();
    lamp(world, at(0, 1.5, 0), 100, 8);
    room(field);
    world.step();
    expect(field.levelAt(at(0, 0, 2))).toBeGreaterThan(0); // on the floor
    expect(field.levelAt(at(4.99, 1.5, 0))).toBeGreaterThan(0);
    expect(field.levelAt(at(5, 1.5, 0))).toBeGreaterThan(0); // on the wall's face
    expect(field.levelAt(at(5.1, 1.5, 0))).toBe(0); // inside the wall
    expect(field.levelAt(at(3, 1.5, 7))).toBe(0); // outside the room, off the doorway line
    expect(field.levelAt(at(0, 1.5, 7))).toBeGreaterThan(0); // through the doorway
  });

  it('AC-2: ramps shadow only below their slope', () => {
    const { world, field } = lightWorld();
    lamp(world, at(0, 1, 0), 100, 12);
    // A 45° ramp climbing +x from x = 2 to x = 4, 2 m high, z −1…1.
    field.statics.add(rampAt(at(2, 0, -1), 45, 2, 2));
    world.step();
    expect(field.levelAt(at(5, 0.2, 0))).toBe(0); // behind the ramp's tall end
    expect(field.levelAt(at(3.5, 1.9, 0))).toBeGreaterThan(0); // above the slope
    expect(field.levelAt(at(2.5, 0.6, 0.5))).toBeGreaterThan(0); // just above the slope
    expect(field.levelAt(at(2.5, 0.4, 0.5))).toBe(0); // just below it, inside the wedge
  });

  it('AC-3: a door closing between an emitter and a room darkens the room on the next tick', () => {
    const { world, field } = lightWorld();
    room(field);
    lamp(world, at(0, 1.5, 8), 100, 8); // outside, in front of the doorway
    const door = thing(world, at(0, 1.5, 5.1), { opaque: false }, 1.5);
    setLightOccluderBox(world, door, at(0.5, 1.5, 0.1));
    world.step();
    const inside = at(0, 1.5, 3);
    const lit = field.levelAt(inside);
    expect(lit).toBeCloseTo(0.140625, 12); // (1 − 5 / 8)²

    setProperty(world, door, 'opaque', true); // the door closes
    expect(field.levelAt(inside)).toBe(lit); // unchanged until the field's next update
    world.step();
    expect(field.levelAt(inside)).toBe(0);
    expect(field.levelAt(at(0, 1.5, 6))).toBeGreaterThan(0); // still lit on the lamp's side

    setProperty(world, door, 'opaque', false); // and opens again
    world.step();
    expect(field.levelAt(inside)).toBe(lit);
  });

  it('AC-3: large opaque objects block light with their bounding sphere, never their own', () => {
    const { world, field } = lightWorld();
    lamp(world, at(0, 1, 0), 100, 8);
    thing(world, at(3, 1, 0), { opaque: true }, 1); // a wardrobe
    thing(world, at(0, 1, -30), { opaque: true }, 1); // far away: never considered
    const glowing = thing(
      world,
      at(0, 1, 3),
      {
        opaque: true,
        lightEmitter: { intensity: 100, radius: 4 },
      },
      0.5,
    );
    world.step();
    expect(field.levelAt(at(5, 1, 0))).toBe(0);
    expect(field.levelAt(at(5, 1, 3))).toBeGreaterThan(0);
    // The glowing crystal lights its surroundings through itself but shadows the lamp behind it.
    const beyond = field.sample(at(0, 1, 4));
    expect(beyond.contributions.map((c) => c.source)).toEqual([
      { kind: 'emitter', entity: glowing },
    ]);
  });

  it('AC-4: a burning entity lights its surroundings until it stops burning, with no registration', () => {
    const { world, field } = lightWorld();
    const crate = thing(world, at(0, 0.5, 0), { flammable: true }, 0.5);
    world.step();
    expect(field.levelAt(at(2, 0.5, 0))).toBe(0);

    assignProperty(world, crate, 'burning', true);
    world.step();
    const sample = field.sample(at(2, 0.5, 0));
    expect(sample.level).toBe((1 - 2 / 8) ** 2); // the default fire light: 100 out to 8 m
    expect(sample.contributions).toEqual([
      { source: { kind: 'emitter', entity: crate }, level: sample.level },
    ]);

    setProperty(world, crate, 'burning', false);
    world.step();
    expect(field.levelAt(at(2, 0.5, 0))).toBe(0);
    expect(field.emitterCount).toBe(0);
  });

  it('AC-4: a burning emitter gives the brighter of its own light and fire light', () => {
    const { world, field } = lightWorld({ fireLight: { intensity: 50, radius: 4 } });
    const torch = thing(world, at(0, 1, 0), {
      lightEmitter: { intensity: 20, radius: 10 },
      burning: true,
    });
    world.step();
    expect(field.levelAt(at(0, 1, 0))).toBe(0.5); // max(20, 50) / 100
    expect(field.levelAt(at(0, 1, 5))).toBe(0.5 * 0.25); // radius max(10, 4)
    setProperty(world, torch, 'burning', false);
    world.step();
    expect(field.levelAt(at(0, 1, 0))).toBe(0.2);
  });

  it('AC-4: light stimuli light their shape for the ticks they resolve', () => {
    const { world, field } = lightWorld();
    const caster = world.spawn();
    applyStimulus(world, {
      shape: { kind: 'sphere', center: at(0, 1, 0), radius: 4 },
      element: 'light',
      intensity: 100,
      source: caster,
    });
    applyStimulus(world, {
      shape: {
        kind: 'cone',
        apex: at(20, 1, 0),
        direction: at(2, 0, 0),
        length: 4,
        halfAngle: 0.5,
      },
      element: 'light',
      intensity: 100,
    });
    applyStimulus(world, {
      shape: { kind: 'capsule', from: at(40, 1, 0), to: at(44, 1, 0), radius: 1 },
      element: 'light',
      intensity: 100,
    });
    applyStimulus(world, {
      shape: { kind: 'box', center: at(60, 1, 0), halfExtents: at(1, 2, 2) },
      element: 'light',
      intensity: 100,
    });
    applyStimulus(world, {
      shape: { kind: 'point', at: at(80, 1, 0) },
      element: 'light',
      intensity: 100,
    });
    applyStimulus(world, {
      shape: { kind: 'sphere', center: at(0, 1, 0), radius: 4 },
      element: 'heat',
      intensity: 100,
    });
    world.step();
    expect(field.emitterCount).toBe(4);
    expect(field.sample(at(2, 1, 0)).contributions).toEqual([
      { source: { kind: 'stimulus', source: caster }, level: 0.25 },
    ]);
    expect(field.levelAt(at(22, 1, 0))).toBe(0.25); // inside the cone
    expect(field.levelAt(at(18, 1, 0))).toBe(0); // behind it
    expect(field.levelAt(at(42, 1, 0))).toBe(1); // capsule centre, reach 2 + 1
    expect(field.levelAt(at(42, 1, 1.5))).toBe(0.25);
    expect(field.levelAt(at(60, 1, 3))).toBe(0); // box reach is its half diagonal, 3 m
    expect(field.levelAt(at(80, 1, 0))).toBe(0); // a point has no reach
    world.step();
    expect(field.emitterCount).toBe(0);
    expect(field.levelAt(at(2, 1, 0))).toBe(0);
  });

  it('only counts light stimuli resolved in the tick being gathered', () => {
    const field = new LightField();
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
    installLightField(world, field);
    const stale: StimulusResolution = {
      tick: 5,
      amount: 100,
      hits: [],
      stimulus: {
        shape: { kind: 'sphere', center: at(0, 0, 0), radius: 4 },
        element: 'light',
        intensity: 100,
        duration: 0,
        source: null,
        falloff: 'linear',
      },
    };
    field.noteStimulus(stale);
    field.update(world);
    expect(field.emitterCount).toBe(0);
  });

  it('spotlights only light positions inside their cone', () => {
    const { world, field } = lightWorld();
    const spot = lamp(world, at(0, 3, 0), 100, 8);
    setLightCone(world, spot, { direction: at(0, -1, 0), halfAngle: Math.PI / 6 });
    world.step();
    expect(field.levelAt(at(0, 3, 0))).toBe(1); // at the source itself
    expect(field.levelAt(at(0, 0, 0))).toBeCloseTo((5 / 8) ** 2, 12);
    expect(field.levelAt(at(1, 0, 0))).toBeGreaterThan(0);
    expect(field.levelAt(at(3, 1, 0))).toBe(0); // outside the cone
    expect(field.levelAt(at(0, 5, 0))).toBe(0); // behind it
  });

  it('AC-5: a position outside every baked region returns the ambient default, not an error', () => {
    const { world, field } = lightWorld({ defaultAmbient: 0.05 });
    room(field);
    lamp(world, at(0, 1.5, 0), 100, 8);
    world.step();
    for (const far of [at(1e7, 1, 1e7), at(0, 5000, 0), at(-3e6, -2000, 4)]) {
      expect(field.sample(far)).toEqual({
        level: 0.05,
        ambient: 0.05,
        zone: null,
        contributions: [],
      });
    }
  });

  it('AC-5: far outside the cell grid, emitters and occlusion are still exact', () => {
    const { world, field } = lightWorld();
    lamp(world, at(2e6, 2000, 0), 100, 8);
    field.statics.add(box(at(2e6 + 2, 1990, -5), at(2e6 + 2.5, 2010, 5)));
    world.step();
    expect(field.levelAt(at(2e6 + 1, 2000, 0))).toBeCloseTo(0.765625, 12);
    expect(field.levelAt(at(2e6 + 3, 2000, 0))).toBe(0);
  });

  it('AC-5: directional light and far-reaching emitters work anywhere, cached or not', () => {
    const { world, field } = lightWorld();
    field.setEnvironment({
      directional: [{ id: 'sun', direction: at(0, -1, 0), level: 0.25, reach: 30 }],
    });
    field.statics.add(box(at(3e6, 10, -1), at(3e6 + 2, 11, 1))); // an awning far out
    lamp(world, at(0, 1, 0), 100, 40); // reaches too far for a dense cache
    world.step();
    expect(field.levelAt(at(3e6 + 1, 1, 0))).toBe(0); // under the awning
    expect(field.levelAt(at(3e6 + 1, 1, 0))).toBe(0); // (cells this far out are not kept)
    expect(field.levelAt(at(3e6 + 5, 1, 0))).toBe(0.25);
    expect(field.levelAt(at(0, 3000, 0))).toBe(0.25); // high above everything
    expect(field.levelAt(at(20, 1, 0))).toBeCloseTo(0.25 + 0.25, 12);
    expect(field.levelAt(at(20, 1, 0))).toBeCloseTo(0.5, 12); // again, from the cache
  });

  it('rejects non-finite sample positions', () => {
    const field = new LightField();
    expect(() => field.levelAt(at(NaN, 0, 0))).toThrow(RangeError);
    expect(() => field.sample(at(0, Infinity, 0))).toThrow(RangeError);
  });

  it('rebakes when the level geometry changes', () => {
    const { world, field } = lightWorld();
    lamp(world, at(0, 1.5, 0), 100, 8);
    const sun: LightEnvironment = {
      directional: [{ id: 'sun', direction: at(0, -1, 0), level: 0.2, reach: 50 }],
    };
    field.setEnvironment(sun);
    world.step();
    const sample = at(3, 1.5, 0);
    expect(field.levelAt(sample)).toBeCloseTo(0.390625 + 0.2, 12);
    const wall = field.statics.add(box(at(2, 0, -3), at(2.2, 3, 3)));
    const roof = field.statics.add(box(at(-10, 3, -10), at(10, 3.2, 10)));
    expect(field.levelAt(sample)).toBe(0); // no update needed: statics are read live
    field.statics.remove(wall);
    field.statics.remove(roof);
    expect(field.levelAt(sample)).toBeCloseTo(0.590625, 12);
    field.statics.add(box(at(2, 0, -3), at(2.2, 3, 3)));
    world.step();
    expect(field.levelAt(sample)).toBeCloseTo(0.2, 12);
  });

  it("keeps an emitter's baked cells while it stays put and rebakes when it moves", () => {
    const { world, field } = lightWorld();
    field.statics.add(box(at(2, 0, -3), at(2.2, 3, 3)));
    const light = lamp(world, at(0, 1.5, 0), 100, 8);
    world.step();
    expect(field.levelAt(at(3, 1.5, 0))).toBe(0);
    world.step();
    expect(field.levelAt(at(3, 1.5, 0))).toBe(0);
    placeEntity(world, light, at(3, 1.5, 1));
    world.step();
    expect(field.levelAt(at(3, 1.5, 0))).toBeCloseTo(0.765625, 12);
  });
});

describe('light environment', () => {
  it('applies the last ambient zone containing the position, else the default', () => {
    const { field } = lightWorld({ defaultAmbient: 0.02 });
    field.setEnvironment({
      ambientZones: [
        { id: 'courtyard', min: at(-20, -5, -20), max: at(20, 30, 20), level: 0.3 },
        { id: 'cellar', min: at(-2, -5, -2), max: at(2, 0, 2), level: 0 },
      ],
    });
    expect(field.sample(at(10, 1, 10))).toMatchObject({
      level: 0.3,
      ambient: 0.3,
      zone: 'courtyard',
    });
    expect(field.sample(at(0, -1, 0))).toMatchObject({ level: 0, zone: 'cellar' });
    expect(field.sample(at(2, 0, 2))).toMatchObject({ zone: 'cellar' }); // bounds are inclusive
    expect(field.sample(at(25, 1, 0))).toMatchObject({ level: 0.02, zone: null });
    field.setEnvironment({});
    expect(field.sample(at(10, 1, 10)).zone).toBeNull();
  });

  it('directional light reaches positions whose path back to it is clear', () => {
    const { world, field } = lightWorld();
    field.setEnvironment({
      directional: [
        { id: 'moon', direction: at(1, -2, 0), level: 0.15, reach: 40 },
        { id: 'eclipsed', direction: at(0, -1, 0), level: 0, reach: 40 },
      ],
    });
    room(field);
    field.statics.add(box(at(-5.2, 3, -5.2), at(0, 3.2, 5.2))); // half a roof over x < 0
    const shutter = thing(world, at(8, 8, 0), { opaque: true }, 1); // up the moon's path from (9, 6, 0)
    world.step();
    expect(field.sample(at(3, 0.5, 0))).toMatchObject({
      level: 0.15,
      contributions: [{ source: { kind: 'directional', id: 'moon' }, level: 0.15 }],
    });
    expect(field.levelAt(at(-3, 0.5, 0))).toBe(0); // under the roof
    expect(field.levelAt(at(9, 6, 0))).toBe(0); // shadowed by the opaque shutter above it
    setProperty(world, shutter, 'opaque', false);
    world.step();
    expect(field.levelAt(at(9, 6, 0))).toBe(0.15);
  });

  it('validates zones and directional lights', () => {
    const field = new LightField();
    const zone = { id: 'z', min: at(0, 0, 0), max: at(1, 1, 1), level: 0.5 };
    const light = { id: 'd', direction: at(0, -1, 0), level: 0.5, reach: 10 };
    const bad: LightEnvironment[] = [
      { ambientZones: [{ ...zone, min: at(NaN, 0, 0) }] },
      { ambientZones: [{ ...zone, max: at(0, Infinity, 0) }] },
      { ambientZones: [{ ...zone, max: at(0, 1, 1) }] },
      { ambientZones: [{ ...zone, max: at(1, 0, 1) }] },
      { ambientZones: [{ ...zone, max: at(1, 1, 0) }] },
      { ambientZones: [{ ...zone, level: 2 }] },
      { directional: [{ ...light, direction: at(0, 0, NaN) }] },
      { directional: [{ ...light, direction: at(0, 0, 0) }] },
      { directional: [{ ...light, level: -1 }] },
      { directional: [{ ...light, reach: 0 }] },
      { directional: [{ ...light, reach: Infinity }] },
    ];
    for (const environment of bad) {
      expect(() => {
        field.setEnvironment(environment);
      }, JSON.stringify(environment)).toThrow(RangeError);
    }
    expect(() => {
      field.setEnvironment({ ambientZones: [zone], directional: [light] });
    }).not.toThrow();
  });
});

describe('light field determinism', () => {
  it('answers do not depend on which positions were sampled before', () => {
    const build = () => {
      const { world, field } = lightWorld();
      room(field);
      field.statics.add(box(at(-1, 0, -1), at(1, 2, 1))); // a block in the middle
      lamp(world, at(-3, 1.5, -3), 100, 9);
      world.step();
      return field;
    };
    const points: Vec3[] = [];
    for (let i = 0; i < 60; i++) {
      points.push(
        at(((i * 37) % 97) / 10 - 4.85, 0.25 + ((i * 13) % 11) / 5, ((i * 53) % 89) / 9 - 4.9),
      );
    }
    const forward = build();
    const backward = build();
    const a = points.map((p) => forward.levelAt(p));
    const b = [...points]
      .reverse()
      .map((p) => backward.levelAt(p))
      .reverse();
    expect(a).toEqual(b);
    expect(a.some((v) => v === 0)).toBe(true);
    expect(a.some((v) => v > 0)).toBe(true);
  });
});
