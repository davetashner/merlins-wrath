import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import type { BodyId } from '../character/collision-world';
import { box, type GreyboxBox } from '../character/greybox';
import { RapierPhysics } from '../physics/rapier';
import { RapierSightWorld } from '../physics/rapier-sight-world';
import type { Vec3 } from '../stimulus/shapes';
import { FakeSightWorld } from './fake-sight-world';
import {
  DEFAULT_SIGHT_SAMPLES,
  LineOfSight,
  type OcclusionVolume,
  type SightQuery,
} from './line-of-sight';
import { OPAQUE, partial, TRANSPARENT, type Occlusion } from './occlusion';
import type { SightWorld } from './sight-world';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** An observer's eye 10 m west of the target. */
const EYE = v(0, 1.7, 0);
const STANDING = { feet: v(10, 0, 0), height: 1.8 };
const CROUCHED = { feet: v(10, 0, 0), height: 1.2 };

const FLOOR = box(v(-20, -1, -20), v(20, 0, 20));
/** A 3 m wall halfway between observer and target. */
const WALL = box(v(5, 0, -5), v(5.3, 3, 5));
/** A 0.75 m crate just in front of the target: hides a crouched target's hips and feet. */
const CRATE = box(v(9.2, 0, -1), v(9.8, 0.75, 1));
const WINDOW = box(v(5, 0, -5), v(5.05, 3, 5));
const BUSH_A = box(v(3, 0, -1), v(4, 2.5, 1));
const BUSH_B = box(v(6, 0, -1), v(7, 2.5, 1));

type Scene = readonly (readonly [GreyboxBox, Occlusion?])[];
type Build = (boxes: readonly GreyboxBox[]) => { world: SightWorld; bodies: readonly BodyId[] };

const BACKENDS: readonly (readonly [string, Build])[] = [
  [
    'FakeSightWorld',
    (boxes) => {
      const world = new FakeSightWorld();
      return { world, bodies: boxes.map((shape) => world.add(shape)) };
    },
  ],
  [
    'RapierSightWorld',
    (boxes) => {
      const physics = new RapierPhysics(RAPIER);
      const bodies = boxes.map((shape) => physics.add(shape));
      physics.step(0);
      return { world: new RapierSightWorld(physics), bodies };
    },
  ],
];

describe.each(BACKENDS)('LineOfSight on %s (mw-e09.1)', (_name, build) => {
  function los(scene: Scene): LineOfSight {
    const { world, bodies } = build([FLOOR, ...scene.map(([shape]) => shape)]);
    const occlusion = new Map<BodyId, Occlusion>();
    bodies.slice(1).forEach((body, i) => {
      const occ = scene[i]?.[1];
      if (occ !== undefined) occlusion.set(body, occ);
    });
    return new LineOfSight({ world, occlusionOf: (body) => occlusion.get(body) });
  }

  it('sees every sample of an unobstructed target', () => {
    expect(los([]).visibleFraction(EYE, STANDING)).toBe(1);
    expect(los([]).visibleFraction(EYE, CROUCHED)).toBe(1);
  });

  it('AC-1: a target fully behind an opaque wall is 0 visible', () => {
    expect(los([[WALL]]).visibleFraction(EYE, STANDING)).toBe(0);
    expect(los([[WALL, OPAQUE]]).visibleFraction(EYE, STANDING)).toBe(0);
  });

  it('AC-2: crouched behind a crate hiding hips and feet, 4 samples see 0.5', () => {
    expect(DEFAULT_SIGHT_SAMPLES).toHaveLength(4);
    expect(los([[CRATE]]).visibleFraction(EYE, CROUCHED)).toBe(0.5);
  });

  it('AC-3: a transparent window leaves the unobstructed value', () => {
    expect(los([[WINDOW, TRANSPARENT]]).visibleFraction(EYE, STANDING)).toBe(
      los([]).visibleFraction(EYE, STANDING),
    );
    expect(los([[WINDOW, TRANSPARENT], [CRATE]]).visibleFraction(EYE, CROUCHED)).toBe(
      los([[CRATE]]).visibleFraction(EYE, CROUCHED),
    );
  });

  it('AC-4: a ray through two partial:0.5 foliage volumes has visibility 0.25', () => {
    const foliage = los([
      [BUSH_A, partial(0.5)],
      [BUSH_B, partial(0.5)],
    ]);
    expect(foliage.ray(EYE, v(10, 1.3, 0))).toBe(0.25);
    expect(foliage.visibleFraction(EYE, STANDING)).toBe(0.25);
  });
});

describe('LineOfSight (mw-e09.1)', () => {
  const open = (): LineOfSight => new LineOfSight({ world: new FakeSightWorld([FLOOR]) });

  it('AC-5: a zero-length ray (observer eye inside the target) is fully visible and does not throw', () => {
    const cast = (): never => {
      throw new Error('a zero-length ray must not be cast');
    };
    const neverQueried: SightWorld = { firstCrossing: cast, forEachCrossing: cast };
    const los = new LineOfSight({ world: neverQueried });
    const target = { feet: v(0, 0, 0), height: 2, samples: [0.85] };
    expect(() => los.visibleFraction(v(0, 1.7, 0), target)).not.toThrow();
    expect(los.visibleFraction(v(0, 1.7, 0), target)).toBe(1);
    expect(
      los.ray(v(1, 2, 3), v(1, 2, 3), {
        volumes: [{ kind: 'box', min: v(0, 0, 0), max: v(5, 5, 5), occlusion: OPAQUE }],
      }),
    ).toBe(1);
    expect(open().visibleFraction(v(10, 1.71, 0), STANDING)).toBe(1);
  });

  it('colliders without a registered occlusion are opaque', () => {
    const los = new LineOfSight({ world: new FakeSightWorld([FLOOR, WALL]) });
    expect(los.visibleFraction(EYE, STANDING)).toBe(0);
  });

  /** A FakeSightWorld that records which crossings line of sight visits. */
  function recording(boxes: readonly GreyboxBox[]): { world: SightWorld; visits: BodyId[] } {
    const visits: BodyId[] = [];
    const inner = new FakeSightWorld(boxes);
    const world: SightWorld = {
      firstCrossing: (from, to) => inner.firstCrossing(from, to),
      forEachCrossing: (from, to, visit) => {
        inner.forEachCrossing(from, to, (body) => {
          visits.push(body);
          return visit(body);
        });
      },
    };
    return { world, visits };
  }

  it('stops tracing a sight line at the first opaque or partial:0 collider', () => {
    const { world, visits } = recording([BUSH_A, BUSH_B, box(v(8, 0, -1), v(8.5, 2.5, 1))]);
    const los = new LineOfSight({ world, occlusionOf: (body) => partial(body === 2 ? 0 : 0.5) });
    expect(los.ray(EYE, v(10, 1.3, 0))).toBe(0);
    expect(visits).toEqual([1, 2]);
  });

  it('does not visit every crossing when the nearest collider is opaque or there is none', () => {
    const { world, visits } = recording([WALL, BUSH_B]);
    const los = new LineOfSight({
      world,
      occlusionOf: (body) => (body === 2 ? partial(0.5) : undefined),
    });
    expect(los.ray(EYE, v(10, 1.3, 0))).toBe(0);
    expect(los.ray(EYE, v(10, 5, 0))).toBe(1);
    expect(visits).toEqual([]);
  });

  it('multiplies occlusion volumes (smoke, foliage) that are not physics into the ray', () => {
    const smoke: OcclusionVolume = {
      kind: 'sphere',
      center: v(5, 1.5, 0),
      radius: 1,
      occlusion: partial(0.5),
    };
    const bush: OcclusionVolume = {
      kind: 'box',
      min: v(3, 0, -1),
      max: v(4, 2.5, 1),
      occlusion: partial(0.5),
    };
    const los = open();
    expect(los.ray(EYE, v(10, 1.3, 0), { volumes: [smoke, bush] })).toBe(0.25);
    expect(los.ray(EYE, v(10, 1.3, 0), { volumes: [smoke] })).toBe(0.5);
    const aside: OcclusionVolume = { ...smoke, center: v(5, 1.5, 5) };
    expect(los.ray(EYE, v(10, 1.3, 0), { volumes: [aside] })).toBe(1);
    const glassBox: OcclusionVolume = { ...bush, occlusion: TRANSPARENT };
    expect(los.ray(EYE, v(10, 1.3, 0), { volumes: [glassBox] })).toBe(1);
  });

  it('combines volumes with partial colliders along the same ray', () => {
    const world = new FakeSightWorld([FLOOR, BUSH_B]);
    const los = new LineOfSight({
      world,
      occlusionOf: (body) => (body === 2 ? partial(0.5) : undefined),
    });
    const smoke: OcclusionVolume = {
      kind: 'box',
      min: v(3, 0, -1),
      max: v(4, 2.5, 1),
      occlusion: partial(0.5),
    };
    expect(los.ray(EYE, v(10, 1.3, 0), { volumes: [smoke] })).toBe(0.25);
  });

  it('an opaque volume blocks without querying the physics world', () => {
    const cast = (): never => {
      throw new Error('not reached');
    };
    const world: SightWorld = { firstCrossing: cast, forEachCrossing: cast };
    const los = new LineOfSight({ world });
    const wall: OcclusionVolume = {
      kind: 'box',
      min: v(5, 0, -5),
      max: v(5.3, 3, 5),
      occlusion: OPAQUE,
    };
    expect(los.visibleFraction(EYE, STANDING, { volumes: [wall] })).toBe(0);
  });

  it('dynamic occluders: a curtain drawn or a door closed changes the next query', () => {
    const world = new FakeSightWorld([FLOOR]);
    const curtain = world.add(box(v(5, 0, -1), v(5.1, 3, 1)));
    const door = world.add(box(v(7, 0, 2), v(7.1, 3, 3)));
    let curtainState: Occlusion = TRANSPARENT;
    const los = new LineOfSight({
      world,
      occlusionOf: (body) => (body === curtain ? curtainState : undefined),
    });
    expect(los.visibleFraction(EYE, STANDING)).toBe(1);
    curtainState = partial(0.25);
    expect(los.visibleFraction(EYE, STANDING)).toBe(0.25);
    world.set(door, box(v(7, 0, -1), v(7.1, 3, 1)));
    expect(los.visibleFraction(EYE, STANDING)).toBe(0);
  });

  it('samples are configurable fractions of the target height', () => {
    const los = new LineOfSight({ world: new FakeSightWorld([FLOOR, CRATE]) });
    expect(los.visibleFraction(EYE, { ...CROUCHED, samples: [0.95, 0.05] })).toBe(0.5);
    expect(los.visibleFraction(EYE, { ...CROUCHED, samples: [0.05] })).toBe(0);
    expect(() => los.visibleFraction(EYE, { ...CROUCHED, samples: [] })).toThrow(RangeError);
  });

  it('batches many observers per tick, reusing an output array', () => {
    const los = new LineOfSight({ world: new FakeSightWorld([FLOOR, CRATE]) });
    const queries: SightQuery[] = [
      { eye: EYE, target: CROUCHED },
      { eye: EYE, target: STANDING },
      { eye: v(10, 1.7, 5), target: CROUCHED },
    ];
    const expected = queries.map(({ eye, target }) => los.visibleFraction(eye, target));
    expect(los.visibleFractions(queries)).toEqual(expected);
    const out = [9, 9, 9, 9, 9];
    expect(los.visibleFractions(queries, {}, out)).toBe(out);
    expect(out).toEqual(expected);
  });
});
