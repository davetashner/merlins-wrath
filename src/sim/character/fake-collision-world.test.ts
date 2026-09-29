import { describe, expect, it } from 'vitest';
import { cos, sin } from '../math';
import type { Vec3 } from '../stimulus/shapes';
import { describeCollisionWorldContract } from './collision-world.contract';
import { FakeCollisionWorld } from './fake-collision-world';
import { box, radians, rampAngle, rampAt, type GreyboxRamp, type RampRise } from './greybox';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const DOWN = v(0, -1, 0);
const STANDING = { radius: 0.35, height: 1.8 };

describeCollisionWorldContract('FakeCollisionWorld', (shapes) => {
  const world = new FakeCollisionWorld();
  const bodies = shapes.map((shape) => world.add(shape));
  return { world, bodies };
});

describe('FakeCollisionWorld', () => {
  it('numbers colliders from 1 in the order they are added, starting with the constructor’s', () => {
    const world = new FakeCollisionWorld([box(v(0, 0, 0), v(1, 1, 1))]);
    expect(world.add(box(v(2, 0, 0), v(3, 1, 1)))).toBe(2);
  });

  it('rejects a shape with no volume on some axis', () => {
    expect(() => new FakeCollisionWorld([box(v(0, 0, 0), v(1, 0, 1))])).toThrow(
      'greybox box: max.y must be above min.y',
    );
  });

  it('moves colliders along their velocity when advanced; setVelocity changes it', () => {
    const world = new FakeCollisionWorld([box(v(-1, -1, -1), v(1, 0, 1))]);
    world.setVelocity(1, v(0, 2, 0));
    world.advance(0.5);
    expect(world.offsetOf(1)).toEqual(v(0, 1, 0));
    const hit = world.sweepCapsule(STANDING, v(0, 3, 0), DOWN, 5);
    expect(hit?.distance).toBeCloseTo(2, 9);
    expect(world.bodyVelocity(1)).toEqual(v(0, 2, 0));
  });

  it('reports zero velocity for an unknown collider and throws when setting one', () => {
    const world = new FakeCollisionWorld();
    expect(world.bodyVelocity(7)).toEqual(v(0, 0, 0));
    expect(() => {
      world.setVelocity(7, v(1, 0, 0));
    }).toThrow('no collider 7');
  });

  it.each<[RampRise, Vec3]>([
    ['+x', v(-1, 1, 0)],
    ['-x', v(1, 1, 0)],
    ['+z', v(0, 1, -1)],
    ['-z', v(0, 1, 1)],
  ])('slopes a 45° ramp rising along %s with the matching normal', (rises, lean) => {
    const ramp: GreyboxRamp = { kind: 'ramp', min: v(-1, 0, -1), max: v(1, 2, 1), rises };
    expect(rampAngle(ramp)).toBeCloseTo(45, 9);
    const world = new FakeCollisionWorld([ramp]);
    const hit = world.raycast(v(0, 5, 0), DOWN, 10);
    const k = Math.SQRT1_2;
    expect(hit?.normal.x).toBeCloseTo(lean.x * k, 9);
    expect(hit?.normal.y).toBeCloseTo(lean.y * k, 9);
    expect(hit?.normal.z).toBeCloseTo(lean.z * k, 9);
    expect(hit?.distance).toBeCloseTo(4, 9);
  });

  it('builds ramps of a given angle', () => {
    const ramp = rampAt(v(0, 0, 0), 40, 2, 3);
    expect(rampAngle(ramp)).toBeCloseTo(40, 9);
    expect(ramp.max.x).toBeCloseTo(2 / (sin(radians(40)) / cos(radians(40))), 9);
  });

  it('hits at once, facing back along the ray, when a ray starts inside a collider', () => {
    const world = new FakeCollisionWorld([box(v(-1, -1, -1), v(1, 1, 1))]);
    expect(world.raycast(v(0, 0, 0), DOWN, 5)).toEqual({
      distance: 0,
      normal: v(0, 1, 0),
      point: v(0, 0, 0),
      body: 1,
    });
  });

  it('misses with a ray parallel to a face and outside it', () => {
    const world = new FakeCollisionWorld([box(v(-1, -1, -1), v(1, 0, 1))]);
    expect(world.raycast(v(-5, 1, 0), v(1, 0, 0), 10)).toBeUndefined();
    expect(world.raycast(v(-5, -0.5, 0), v(1, 0, 0), 10)?.distance).toBeCloseTo(4, 9);
  });

  it('misses with a ray running parallel to a ramp’s slope above it', () => {
    const world = new FakeCollisionWorld([
      { kind: 'ramp', min: v(0, 0, -1), max: v(2, 2, 1), rises: '+x' },
    ]);
    expect(world.raycast(v(0, 0.5, 0), v(Math.SQRT1_2, Math.SQRT1_2, 0), 2)).toBeUndefined();
  });

  it('reports the more distant of two overlapping colliders only when it is nearer', () => {
    const world = new FakeCollisionWorld([
      box(v(-1, -1, -1), v(1, 0, 1)),
      box(v(-1, -3, -1), v(1, -2, 1)),
    ]);
    expect(world.raycast(v(0, 5, 0), DOWN, 10)?.body).toBe(1);
    expect(world.sweepCapsule(STANDING, v(0, 5, 0), DOWN, 10)?.body).toBe(1);
  });

  it('blocks a capsule overlapping a collider only while it moves deeper', () => {
    const world = new FakeCollisionWorld([box(v(-1, -1, -1), v(1, 0, 1))]);
    const sunk = v(0, -0.2, 0);
    expect(world.sweepCapsule(STANDING, sunk, v(0, 1, 0), 1)).toBeUndefined();
    const hit = world.sweepCapsule(STANDING, sunk, DOWN, 1);
    expect(hit?.distance).toBe(0);
    expect(hit?.normal).toEqual(v(0, 1, 0));
  });

  it('picks the face met most head-on when a sweep reaches an edge', () => {
    const world = new FakeCollisionWorld([box(v(1, 0, 1), v(2, 2, 2))]);
    // Aimed at the box's -x/-z vertical edge, mostly along x.
    const dir = v(0.8, 0, 0.6);
    const hit = world.sweepCapsule(STANDING, v(1 - 0.35 - 0.8, 0.5, 1 - 0.35 - 0.6), dir, 3);
    expect(hit?.distance).toBeCloseTo(1, 9);
    expect(hit?.normal).toEqual(v(-1, 0, 0));
  });

  it('treats a capsule no taller than its diameter as a sphere', () => {
    const world = new FakeCollisionWorld([box(v(-1, -1, -1), v(1, 0, 1))]);
    const hit = world.sweepCapsule({ radius: 0.5, height: 0.5 }, v(0, 2, 0), DOWN, 5);
    expect(hit?.distance).toBeCloseTo(2, 9);
    expect(world.overlapCapsule({ radius: 0.5, height: 1 }, v(0, -0.1, 0))).toBe(true);
  });
});
