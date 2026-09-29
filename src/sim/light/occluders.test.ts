import { describe, expect, it } from 'vitest';
import { box, type GreyboxRamp, type RampRise } from '../character/greybox';
import type { ColliderHandle } from '../physics/static-colliders';
import type { Vec3 } from '../stimulus/shapes';
import {
  boxOccluder,
  occluderOf,
  segmentHits,
  segmentHitsSphere,
  StaticOccluders,
  type Occluder,
} from './occluders';

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const hits = (o: Occluder, a: Vec3, b: Vec3, grow = 0) =>
  segmentHits(o, a.x, a.y, a.z, b.x, b.y, b.z, grow);

describe('segment vs box', () => {
  const cube = boxOccluder(at(0, 0, 0), at(1, 1, 1));

  it('hits a segment through the interior, from either direction', () => {
    expect(hits(cube, at(-1, 0.5, 0.5), at(2, 0.5, 0.5))).toBe(true);
    expect(hits(cube, at(2, 0.5, 0.5), at(-1, 0.5, 0.5))).toBe(true);
    expect(hits(cube, at(-1, -1, -1), at(2, 2, 2))).toBe(true);
  });

  it('misses segments that stop short, pass by or only touch the surface', () => {
    expect(hits(cube, at(-1, 0.5, 0.5), at(-0.1, 0.5, 0.5))).toBe(false); // short
    expect(hits(cube, at(-1, 2, 0.5), at(2, 2, 0.5))).toBe(false); // above, parallel
    expect(hits(cube, at(-1, 1, 0.5), at(2, 1, 0.5))).toBe(false); // along the top face
    expect(hits(cube, at(-1, 0.5, 0.5), at(0, 0.5, 0.5))).toBe(false); // ends on a face
    expect(hits(cube, at(-1, 0.5, -1), at(2, 0.5, 2))).toBe(true);
    expect(hits(cube, at(-1, 0.5, 0), at(1, 0.5, 2))).toBe(false); // grazes an edge
    expect(hits(cube, at(-1, 3, 0.5), at(2, 0.5, 0.5))).toBe(false); // passes over it
    expect(hits(cube, at(0.5, 0.5, -1), at(0.5, 3, 1.5))).toBe(false); // exits z before entering y
  });

  it('a grown box also catches near misses', () => {
    expect(hits(cube, at(-1, 1.2, 0.5), at(2, 1.2, 0.5), 0.5)).toBe(true);
    expect(hits(cube, at(-1, 1.6, 0.5), at(2, 1.6, 0.5), 0.5)).toBe(false);
  });

  it('a segment starting inside is blocked', () => {
    expect(hits(cube, at(0.5, 0.5, 0.5), at(3, 3, 3))).toBe(true);
  });
});

describe('segment vs ramp', () => {
  const ramp = (rises: RampRise): Occluder =>
    occluderOf({ kind: 'ramp', min: at(0, 0, 0), max: at(2, 2, 2), rises } satisfies GreyboxRamp);

  it('blocks below the slope and not above it, for every rise direction', () => {
    const cases: [RampRise, (u: number, y: number) => Vec3][] = [
      ['+x', (u, y) => at(u, y, 1)],
      ['-x', (u, y) => at(2 - u, y, 1)],
      ['+z', (u, y) => at(1, y, u)],
      ['-z', (u, y) => at(1, y, 2 - u)],
    ];
    for (const [rises, point] of cases) {
      const wedge = ramp(rises);
      // A horizontal segment at height 0.5 across the low half: below the slope past u = 0.5.
      const across = (y: number) => hits(wedge, point(-1, y), point(3, y));
      expect(across(0.5), rises).toBe(true);
      // From the tall end towards the low one, stopping while still under the slope.
      expect(hits(wedge, point(3, 0.5), point(1, 0.5)), rises).toBe(true);
      // A segment over the slope, parallel to it, 0.2 m above: clear. Grown, the slope is ignored.
      expect(hits(wedge, point(0, 0.4), point(1.6, 2)), rises).toBe(false);
      expect(hits(wedge, point(0, 0.4), point(1.6, 2), 0.01), rises).toBe(true);
      // Entering from the tall end and climbing out through the slope.
      expect(hits(wedge, point(3, 1), point(1, 1.5)), rises).toBe(true);
      // Descending onto the slope from above and stopping short of it.
      expect(hits(wedge, point(0.5, 2), point(0.5, 0.6)), rises).toBe(false);
      expect(hits(wedge, point(0.5, 2), point(0.5, 0.4)), rises).toBe(true);
      // Parallel to the slope inside the wedge.
      expect(hits(wedge, point(0.2, 0.1), point(1.8, 1.7)), rises).toBe(true);
    }
  });

  it('a box collider is a plain box', () => {
    expect(occluderOf(box(at(0, 0, 0), at(1, 1, 1)))).toEqual(
      boxOccluder(at(0, 0, 0), at(1, 1, 1)),
    );
  });
});

describe('segment vs sphere', () => {
  const sphere = (a: Vec3, b: Vec3, r = 1) =>
    segmentHitsSphere(a.x, a.y, a.z, b.x, b.y, b.z, 0, 0, 0, r);

  it('hits when the segment passes inside the ball', () => {
    expect(sphere(at(-2, 0.5, 0), at(2, 0.5, 0))).toBe(true);
    expect(sphere(at(-2, 1, 0), at(2, 1, 0))).toBe(false); // tangent
    expect(sphere(at(2, 0, 0), at(3, 0, 0))).toBe(false); // beyond the far end
    expect(sphere(at(-3, 0, 0), at(-2, 0, 0))).toBe(false); // before the near end
    expect(sphere(at(0.5, 0, 0), at(0.5, 0, 0))).toBe(true); // a point inside
    expect(sphere(at(0, 0, 0), at(3, 0, 0), 0)).toBe(false); // radius 0 blocks nothing
  });
});

describe('static occluders', () => {
  it('is a collider sink: add, remove, count, version', () => {
    const statics = new StaticOccluders();
    const v0 = statics.version;
    const a = statics.add(box(at(0, 0, 0), at(1, 1, 1)));
    const b = statics.add(box(at(5, 0, 0), at(6, 1, 1)));
    expect(statics.count()).toBe(2);
    expect(statics.version).toBe(v0 + 2);
    statics.remove(a);
    expect(statics.count()).toBe(1);
    expect(() => {
      statics.remove(a);
    }).toThrow(/not in this light occluder set/);
    expect(() => {
      statics.remove(999 as ColliderHandle);
    }).toThrow();
    statics.remove(b);
    expect(statics.count()).toBe(0);
  });

  it('finds each occluder along a segment once, however many buckets it spans', () => {
    const statics = new StaticOccluders();
    statics.add(box(at(-20, -1, -20), at(20, 0, 20))); // a floor over many buckets
    statics.add(box(at(3, 0, -1), at(3.5, 3, 1)));
    statics.add(box(at(3.2, 0, -1), at(3.8, 3, 1))); // shares buckets with the one before
    statics.add(box(at(30, 0, 30), at(31, 1, 31)));
    expect(statics.along(0, 1, 0, 10, 1, 0, 0)).toHaveLength(2);
    expect(statics.along(0, 1, 0, 10, 1, 0, 0)).toHaveLength(2); // stamps reset per gather
    expect(statics.along(0, 1, 0, 10, 1, 0, 1.5)).toHaveLength(3); // grown: the floor too
    expect(statics.along(10, 1, 0, 0, 1, 0, 0)).toHaveLength(2);
    expect(statics.along(0, 1, 5, 0, 1, 10, 0)).toHaveLength(0);
    statics.add(box(at(5, 0, -1), at(5.5, 3, 1)));
    expect(statics.along(0, 1, 0, 10, 1, 0, 0)).toHaveLength(3); // rebuilt after a change
  });

  it('clamps the bucket grid far from the origin without losing occluders', () => {
    const statics = new StaticOccluders();
    statics.add(box(at(-1e9, 0, -1e9), at(-1e9 + 1, 1, -1e9 + 1)));
    statics.add(box(at(1e9, 0, 1e9), at(1e9 + 1, 1, 1e9 + 1)));
    expect(statics.along(-1e9 - 1, 0.5, -1e9 + 0.5, -1e9 + 2, 0.5, -1e9 + 0.5, 0)).toHaveLength(1);
    expect(statics.along(1e9 - 1, 0.5, 1e9 + 0.5, 1e9 + 2, 0.5, 1e9 + 0.5, 0)).toHaveLength(1);
  });
});
