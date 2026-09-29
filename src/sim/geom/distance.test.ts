import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../stimulus/shapes';
import {
  boxCorners,
  boxesOverlap,
  pointBoxSq,
  pointSegmentSq,
  pointTriangleSq,
  segmentBoxSq,
  segmentSegmentSq,
  segmentTriangleSq,
  triangleBoxSq,
  triangleTriangleSq,
  type Obb,
} from './distance';
import { add, distanceSq, lerp, rotate, scale, v3 } from './vec';

// Triangle in the z = 0 plane used for region cases.
const A = v3(0, 0, 0);
const B = v3(1, 0, 0);
const C = v3(0, 1, 0);

const AXES: Obb['axes'] = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
const unitBox = (center: Vec3 = v3(0, 0, 0), half = 0.5): Obb => ({
  center,
  axes: AXES,
  half: [half, half, half],
});
/** A box turned 45° about +y. */
function turnedBox(center: Vec3, half: readonly [number, number, number]): Obb {
  const q = { x: 0, y: 0.3826834323650898, z: 0, w: 0.9238795325112867 }; // sin, cos of π/8
  return {
    center,
    axes: [rotate(q, v3(1, 0, 0)), rotate(q, v3(0, 1, 0)), rotate(q, v3(0, 0, 1))],
    half,
  };
}

/** Deterministic pseudo-random numbers in [0, 1) (tests only; the sim has its own Rng). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const randomPoint = (next: () => number, spread = 3): Vec3 =>
  v3((next() - 0.5) * spread, (next() - 0.5) * spread, (next() - 0.5) * spread);

// Brute-force references: sample both shapes densely; the exact distance is never above the sampled
// one and never far below it.
const N = 24;
function segmentSamples(p: Vec3, q: Vec3): Vec3[] {
  return Array.from({ length: N + 1 }, (_, i) => lerp(p, q, i / N));
}
function triangleSamples(a: Vec3, b: Vec3, c: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; i + j <= N; j++) {
      out.push(add(a, add(scale(add(b, scale(a, -1)), i / N), scale(add(c, scale(a, -1)), j / N))));
    }
  }
  return out;
}
function boxSamples(box: Obb): Vec3[] {
  const out: Vec3[] = [];
  const M = 8;
  for (let i = 0; i <= M; i++) {
    for (let j = 0; j <= M; j++) {
      for (let k = 0; k <= M; k++) {
        const [u, v, w] = box.axes;
        const [h0, h1, h2] = box.half;
        out.push(
          add(
            box.center,
            add(
              scale(u, h0 * (2 * (i / M) - 1)),
              add(scale(v, h1 * (2 * (j / M) - 1)), scale(w, h2 * (2 * (k / M) - 1))),
            ),
          ),
        );
      }
    }
  }
  return out;
}
function sampledSq(xs: readonly Vec3[], ys: readonly Vec3[]): number {
  let best = Infinity;
  for (const x of xs) for (const y of ys) best = Math.min(best, distanceSq(x, y));
  return best;
}
function agrees(exactSq: number, samplesSq: number, tolerance: number): void {
  const exact = Math.sqrt(exactSq);
  const sampled = Math.sqrt(samplesSq);
  expect(exact).toBeLessThanOrEqual(sampled + 1e-9);
  expect(sampled - exact).toBeLessThanOrEqual(tolerance);
}

describe('geom distances (mw-e04.2)', () => {
  it('pointSegmentSq: interior, both ends and a zero-length segment', () => {
    expect(pointSegmentSq(v3(0.5, 1, 0), A, B)).toBe(1);
    expect(pointSegmentSq(v3(-1, 0, 0), A, B)).toBe(1);
    expect(pointSegmentSq(v3(3, 0, 0), A, B)).toBe(4);
    expect(pointSegmentSq(v3(0, 2, 0), A, A)).toBe(4);
  });

  it('segmentSegmentSq: crossing, parallel, degenerate and clamped cases', () => {
    // Crossing skew segments 1 apart.
    expect(segmentSegmentSq(v3(-1, 0, 0), v3(1, 0, 0), v3(0, -1, 1), v3(0, 1, 1))).toBe(1);
    // Zero-length first / second segment.
    expect(segmentSegmentSq(v3(0, 1, 0), v3(0, 1, 0), A, B)).toBe(1);
    expect(segmentSegmentSq(A, B, v3(0.5, 2, 0), v3(0.5, 2, 0))).toBe(4);
    // Parallel, overlapping along their length.
    expect(segmentSegmentSq(A, B, v3(0.5, 1, 0), v3(2, 1, 0))).toBe(1);
    // Parallel, disjoint: end to end.
    expect(segmentSegmentSq(A, B, v3(3, 0, 0), v3(4, 0, 0))).toBe(4);
    // t clamped below 0 and above 1.
    expect(segmentSegmentSq(A, B, v3(0.5, 1, 0), v3(0.5, 3, 0))).toBe(1);
    expect(segmentSegmentSq(A, B, v3(0.5, -3, 0), v3(0.5, -1, 0))).toBe(1);
  });

  it('segmentSegmentSq agrees with brute force on random pairs', () => {
    const next = lcg(7);
    for (let i = 0; i < 40; i++) {
      const [p1, q1, p2, q2] = [0, 1, 2, 3].map(() => randomPoint(next)) as [
        Vec3,
        Vec3,
        Vec3,
        Vec3,
      ];
      agrees(
        segmentSegmentSq(p1, q1, p2, q2),
        sampledSq(segmentSamples(p1, q1), segmentSamples(p2, q2)),
        0.1,
      );
    }
  });

  it('pointTriangleSq: every Voronoi region and a degenerate triangle', () => {
    expect(pointTriangleSq(v3(-1, -1, 1), A, B, C)).toBe(3); // vertex a
    expect(pointTriangleSq(v3(2, -1, 0), A, B, C)).toBe(2); // vertex b
    expect(pointTriangleSq(v3(-1, 2, 0), A, B, C)).toBe(2); // vertex c
    expect(pointTriangleSq(v3(0.5, -1, 0), A, B, C)).toBe(1); // edge ab
    expect(pointTriangleSq(v3(-1, 0.5, 0), A, B, C)).toBe(1); // edge ac
    expect(pointTriangleSq(v3(1, 1, 0), A, B, C)).toBeCloseTo(0.5, 12); // edge bc
    expect(pointTriangleSq(v3(0.25, 0.25, 2), A, B, C)).toBe(4); // face
    // Collinear points: the distance to the line segment they span.
    expect(pointTriangleSq(v3(1, 1, 0), A, B, v3(2, 0, 0))).toBe(1);
  });

  it('pointTriangleSq agrees with brute force on random cases', () => {
    const next = lcg(11);
    for (let i = 0; i < 60; i++) {
      const [p, a, b, c] = [0, 1, 2, 3].map(() => randomPoint(next)) as [Vec3, Vec3, Vec3, Vec3];
      agrees(pointTriangleSq(p, a, b, c), sampledSq([p], triangleSamples(a, b, c)), 0.1);
    }
  });

  it('segmentTriangleSq: piercing, same side, coplanar, missing past each edge, degenerate', () => {
    expect(segmentTriangleSq(v3(0.2, 0.2, -1), v3(0.2, 0.2, 1), A, B, C)).toBe(0); // pierces
    expect(segmentTriangleSq(v3(0.2, 0.2, 1), v3(0.2, 0.2, 2), A, B, C)).toBe(1); // above
    expect(segmentTriangleSq(v3(0.2, 0.2, -2), v3(0.2, 0.2, -1), A, B, C)).toBe(1); // below
    expect(segmentTriangleSq(v3(0.1, 0.1, 0), v3(0.2, 0.2, 0), A, B, C)).toBe(0); // coplanar inside
    expect(segmentTriangleSq(v3(2, 2, 0), v3(3, 3, 0), A, B, C)).toBeCloseTo(4.5, 12); // coplanar out
    // Crosses the plane outside the triangle, beyond each edge in turn.
    expect(segmentTriangleSq(v3(0.5, -1, -1), v3(0.5, -1, 1), A, B, C)).toBe(1); // past ab
    expect(segmentTriangleSq(v3(1, 1, -1), v3(1, 1, 1), A, B, C)).toBeCloseTo(0.5, 12); // past bc
    expect(segmentTriangleSq(v3(-1, 0.5, -1), v3(-1, 0.5, 1), A, B, C)).toBe(1); // past ca
    // Degenerate triangle: its edges only.
    expect(segmentTriangleSq(v3(0.5, -1, 1), v3(0.5, 1, 1), A, B, v3(2, 0, 0))).toBe(1);
  });

  it('segmentTriangleSq agrees with brute force on random cases', () => {
    const next = lcg(13);
    for (let i = 0; i < 40; i++) {
      const [p, q, a, b, c] = [0, 1, 2, 3, 4].map(() => randomPoint(next)) as [
        Vec3, Vec3, Vec3, Vec3, Vec3,
      ]; // prettier-ignore
      agrees(
        segmentTriangleSq(p, q, a, b, c),
        sampledSq(segmentSamples(p, q), triangleSamples(a, b, c)),
        0.15,
      );
    }
  });

  it('triangleTriangleSq: interlocking triangles touch; stacked ones are apart', () => {
    const t1 = [A, B, C] as const;
    const through = [v3(0.2, 0.2, -1), v3(0.2, 0.2, 1), v3(3, 3, 0.5)] as const;
    expect(triangleTriangleSq(t1, through)).toBe(0);
    const above = [v3(0, 0, 2), v3(1, 0, 2), v3(0, 1, 2)] as const;
    expect(triangleTriangleSq(t1, above)).toBe(4);
  });

  it('pointBoxSq: inside is 0, outside counts each axis excess, turned boxes too', () => {
    expect(pointBoxSq(v3(0.2, -0.3, 0.1), unitBox())).toBe(0);
    expect(pointBoxSq(v3(1.5, 0, 0), unitBox())).toBe(1);
    expect(pointBoxSq(v3(1.5, 1.5, -1.5), unitBox())).toBe(3);
    const turned = turnedBox(v3(0, 0, 0), [0.5, 0.5, 0.5]);
    // Along the turned box's own x axis.
    expect(pointBoxSq(scale(turned.axes[0], 2), turned)).toBeCloseTo(2.25, 12);
  });

  it('boxCorners lists the eight corners', () => {
    const corners = boxCorners(unitBox(v3(1, 0, 0)));
    expect(corners).toHaveLength(8);
    expect(corners[0]).toEqual(v3(0.5, -0.5, -0.5));
    expect(corners[7]).toEqual(v3(1.5, 0.5, 0.5));
  });

  it('segmentBoxSq: crossing, inside, parallel inside/outside a slab, missing', () => {
    expect(segmentBoxSq(v3(-2, 0, 0), v3(2, 0, 0), unitBox())).toBe(0); // through
    expect(segmentBoxSq(v3(0, 0, 0), v3(0.1, 0.1, 0.1), unitBox())).toBe(0); // inside
    expect(segmentBoxSq(v3(-2, 1, 0), v3(2, 1, 0), unitBox())).toBeCloseTo(0.25, 12); // parallel out
    expect(segmentBoxSq(v3(1, 1, -2), v3(1, 1, 2), unitBox())).toBeCloseTo(0.5, 12); // edge
    expect(segmentBoxSq(v3(2, -2, 0), v3(2, 2, 0), unitBox())).toBeCloseTo(2.25, 12); // lo > hi
    // A diagonal that misses the corner: the closest feature is an edge.
    expect(segmentBoxSq(v3(1.5, 0, -1), v3(0, 1.5, -1), unitBox())).toBeCloseTo(0.375, 12);
  });

  it('segmentBoxSq agrees with brute force on random turned boxes', () => {
    const next = lcg(17);
    for (let i = 0; i < 30; i++) {
      const box = turnedBox(randomPoint(next, 1), [0.2 + next() * 0.5, 0.2 + next(), 0.3]);
      const p = randomPoint(next, 4);
      const q = randomPoint(next, 4);
      agrees(segmentBoxSq(p, q, box), sampledSq(segmentSamples(p, q), boxSamples(box)), 0.2);
    }
  });

  it('triangleBoxSq: a meeting triangle is 0; otherwise the nearest features', () => {
    expect(triangleBoxSq(v3(-2, 0, -2), v3(2, 0, -2), v3(0, 0, 2), unitBox())).toBe(0);
    // Triangle below the box, facing it: the box face is 1.5 − 0.5 = 1 away.
    expect(triangleBoxSq(v3(-2, -1.5, -2), v3(2, -1.5, -2), v3(0, -1.5, 2), unitBox())).toBe(1);
    // A triangle past a box edge (separated along a cross-product axis).
    const t = [v3(1.2, 0.2, -1), v3(0.2, 1.2, -1), v3(0.7, 0.7, 1)] as const;
    expect(triangleBoxSq(...t, unitBox())).toBeGreaterThan(0);
  });

  it('triangleBoxSq agrees with brute force on random cases', () => {
    const next = lcg(19);
    for (let i = 0; i < 25; i++) {
      const box = turnedBox(randomPoint(next, 1), [0.3, 0.2 + next() * 0.4, 0.4]);
      const [a, b, c] = [0, 1, 2].map(() => randomPoint(next, 4)) as [Vec3, Vec3, Vec3];
      agrees(
        triangleBoxSq(a, b, c, box),
        sampledSq(triangleSamples(a, b, c), boxSamples(box)),
        0.25,
      );
    }
  });

  it('boxesOverlap: overlapping, touching, apart on a face axis and on an edge-edge axis', () => {
    expect(boxesOverlap(unitBox(), unitBox(v3(0.5, 0.5, 0)))).toBe(true);
    expect(boxesOverlap(unitBox(), unitBox(v3(1, 0, 0)))).toBe(true);
    expect(boxesOverlap(unitBox(), unitBox(v3(2, 0, 0)))).toBe(false);
    // A 45° box off a vertical edge of an axis-aligned one: separated along the turned box's face axis.
    const a = unitBox();
    const b = turnedBox(v3(1.05, 0, 1.05), [0.5, 0.5, 0.5]);
    expect(boxesOverlap(a, b)).toBe(false);
    expect(boxesOverlap(a, turnedBox(v3(0.7, 0, 0.7), [0.5, 0.5, 0.5]))).toBe(true);
  });
});
