import { describe, expect, it } from 'vitest';
import {
  boundsOverlap,
  composePose,
  IDENTITY_POSE,
  MAX_BOX_SUBSTEPS,
  obbOf,
  pieceBounds,
  pieceOf,
  piecesOverlap,
  placeShape,
  shapesOverlap,
  simplexBoxSq,
  simplexDistanceSq,
  sweepPieces,
  transformPoint,
  unionBounds,
  type GeomBox,
  type GeomShape,
  type Piece,
  type Pose,
} from './shapes';
import { IDENTITY_QUAT, v3 } from './vec';

const H = Math.SQRT1_2;
/** 90° about +y: +z → +x. */
const YAW_90 = { x: 0, y: H, z: 0, w: H };
const turned: Pose = { position: v3(1, 0, 0), rotation: YAW_90 };

const box = (center = v3(0, 0, 0), half = 0.5): GeomBox => ({
  kind: 'box',
  center,
  halfExtents: v3(half, half, half),
  rotation: IDENTITY_QUAT,
});

function close(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  expect(a.x).toBeCloseTo(b.x, 12);
  expect(a.y).toBeCloseTo(b.y, 12);
  expect(a.z).toBeCloseTo(b.z, 12);
}

describe('geom shapes (mw-e04.2)', () => {
  it('transformPoint and composePose apply rotation then translation, outer after inner', () => {
    close(transformPoint(turned, v3(0, 0, 1)), v3(2, 0, 0));
    const inner: Pose = { position: v3(0, 0, 1), rotation: YAW_90 };
    const both = composePose(turned, inner);
    close(both.position, v3(2, 0, 0));
    close(transformPoint(both, v3(0, 0, 1)), v3(2, 0, -1));
    expect(transformPoint(IDENTITY_POSE, v3(1, 2, 3))).toEqual(v3(1, 2, 3));
  });

  it('placeShape places spheres, capsules and boxes (boxes take the pose rotation)', () => {
    const sphere = placeShape({ kind: 'sphere', center: v3(0, 0, 1), radius: 0.3 }, turned);
    expect(sphere.kind).toBe('sphere');
    if (sphere.kind === 'sphere') close(sphere.center, v3(2, 0, 0));
    const capsule = placeShape(
      { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 0, 1), radius: 0.1 },
      turned,
    );
    expect(capsule).toMatchObject({ kind: 'capsule', radius: 0.1 });
    if (capsule.kind === 'capsule') close(capsule.to, v3(2, 0, 0));
    const placed = placeShape(
      { kind: 'box', center: v3(0, 0, 1), halfExtents: v3(1, 2, 3) },
      turned,
    );
    expect(placed).toMatchObject({ kind: 'box', halfExtents: v3(1, 2, 3), rotation: YAW_90 });
  });

  it('obbOf turns the axes; pieceOf maps each kind', () => {
    const obb = obbOf({ ...box(), rotation: YAW_90 });
    close(obb.axes[2], v3(1, 0, 0));
    expect(pieceOf({ kind: 'sphere', center: v3(0, 0, 0), radius: 1 })).toMatchObject({
      kind: 'simplex',
      radius: 1,
    });
    expect(
      pieceOf({ kind: 'capsule', from: v3(0, 0, 0), to: v3(1, 0, 0), radius: 1 }),
    ).toMatchObject({ kind: 'simplex', points: [v3(0, 0, 0), v3(1, 0, 0)] });
    expect(pieceOf(box()).kind).toBe('box');
  });

  it('simplexDistanceSq covers every pair of point, segment and triangle', () => {
    const p = [v3(0, 0, 2)] as const;
    const seg = [v3(-1, 0, 1), v3(1, 0, 1)] as const;
    const tri = [v3(-1, -1, 0), v3(1, -1, 0), v3(0, 1, 0)] as const;
    const tri2 = [v3(-1, -1, 3), v3(1, -1, 3), v3(0, 1, 3)] as const;
    expect(simplexDistanceSq(p, [v3(0, 0, 0)])).toBe(4);
    expect(simplexDistanceSq(seg, p)).toBe(1);
    expect(simplexDistanceSq(p, seg)).toBe(1);
    expect(simplexDistanceSq(seg, [v3(0, -1, 3), v3(0, 1, 3)])).toBe(4);
    expect(simplexDistanceSq(tri, p)).toBe(4);
    expect(simplexDistanceSq(seg, tri)).toBe(1);
    expect(simplexDistanceSq(tri, tri2)).toBe(9);
  });

  it('simplexBoxSq covers a point, a segment and a triangle', () => {
    const obb = obbOf(box());
    expect(simplexBoxSq([v3(0, 0, 1.5)], obb)).toBe(1);
    expect(simplexBoxSq([v3(-1, 0, 1.5), v3(1, 0, 1.5)], obb)).toBe(1);
    expect(simplexBoxSq([v3(-1, -1, 1.5), v3(1, -1, 1.5), v3(0, 1, 1.5)], obb)).toBe(1);
  });

  it('piecesOverlap: box–box, box–simplex either way, simplex–simplex with radii', () => {
    const b = pieceOf(box());
    const far = pieceOf(box(v3(3, 0, 0)));
    const ball = (x: number, r: number): Piece =>
      pieceOf({ kind: 'sphere', center: v3(x, 0, 0), radius: r });
    expect(piecesOverlap(b, pieceOf(box(v3(0.9, 0, 0))))).toBe(true);
    expect(piecesOverlap(b, far)).toBe(false);
    expect(piecesOverlap(b, ball(1, 0.5))).toBe(true);
    expect(piecesOverlap(ball(1, 0.5), b)).toBe(true);
    expect(piecesOverlap(ball(1.1, 0.5), b)).toBe(false);
    expect(piecesOverlap(ball(0, 0.5), ball(1, 0.5))).toBe(true);
    expect(piecesOverlap(ball(0, 0.5), ball(1.01, 0.5))).toBe(false);
  });

  it('shapesOverlap tests two shapes', () => {
    const a: GeomShape = { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 2, 0), radius: 0.4 };
    expect(shapesOverlap(a, { kind: 'sphere', center: v3(0.5, 1, 0), radius: 0.2 })).toBe(true);
    expect(shapesOverlap(a, { kind: 'sphere', center: v3(1, 1, 0), radius: 0.2 })).toBe(false);
  });

  it('sweepPieces: a sphere sweeps a rounded segment, a capsule two rounded triangles', () => {
    const s0: GeomShape = { kind: 'sphere', center: v3(-2, 0, 0), radius: 0.1 };
    const s1: GeomShape = { kind: 'sphere', center: v3(2, 0, 0), radius: 0.1 };
    const thin: GeomShape = { kind: 'sphere', center: v3(0, 0, 0), radius: 0.05 };
    expect(shapesOverlap(s0, thin) || shapesOverlap(s1, thin)).toBe(false);
    expect(sweepPieces(s0, s1).some((p) => piecesOverlap(p, pieceOf(thin)))).toBe(true);

    const c0: GeomShape = { kind: 'capsule', from: v3(0, 1, 0), to: v3(1, 1, -1), radius: 0.05 };
    const c1: GeomShape = { kind: 'capsule', from: v3(0, 1, 0), to: v3(1, 1, 1), radius: 0.05 };
    const post: GeomShape = {
      kind: 'capsule',
      from: v3(0.7, 0, 0),
      to: v3(0.7, 2, 0),
      radius: 0.02,
    };
    expect(shapesOverlap(c0, post) || shapesOverlap(c1, post)).toBe(false);
    const pieces = sweepPieces(c0, c1);
    expect(pieces).toHaveLength(2);
    expect(pieces.some((p) => piecesOverlap(p, pieceOf(post)))).toBe(true);
  });

  it('sweepPieces: a box samples in-between poses, at most MAX_BOX_SUBSTEPS', () => {
    // Still: one step, both ends.
    expect(sweepPieces(box(), box())).toHaveLength(2);
    // 2 m with 0.5 m half extents: four steps.
    expect(sweepPieces(box(), box(v3(2, 0, 0)))).toHaveLength(5);
    const long = sweepPieces(box(), box(v3(100, 0, 0)));
    expect(long).toHaveLength(MAX_BOX_SUBSTEPS + 1);
    // A thin wall between the ends is caught by the in-between boxes.
    const wall: GeomShape = {
      kind: 'box',
      center: v3(1, 0, 0),
      halfExtents: v3(0.01, 1, 1),
      rotation: IDENTITY_QUAT,
    };
    expect(shapesOverlap(box(), wall)).toBe(false);
    expect(sweepPieces(box(), box(v3(2, 0, 0))).some((p) => piecesOverlap(p, pieceOf(wall)))).toBe(
      true,
    );
    // Rotation is interpolated too.
    const spun = sweepPieces(box(), { ...box(), rotation: YAW_90 });
    expect(spun.length).toBeGreaterThan(2);
  });

  it('bounds: of simplices and boxes, unions and overlap', () => {
    const a = pieceBounds(pieceOf({ kind: 'sphere', center: v3(0, 0, 0), radius: 1 }));
    expect(a).toEqual({ min: v3(-1, -1, -1), max: v3(1, 1, 1) });
    const b = pieceBounds(pieceOf(box(v3(3, 0, 0))));
    expect(b).toEqual({ min: v3(2.5, -0.5, -0.5), max: v3(3.5, 0.5, 0.5) });
    expect(unionBounds(a, b)).toEqual({ min: v3(-1, -1, -1), max: v3(3.5, 1, 1) });
    expect(boundsOverlap(a, b)).toBe(false);
    expect(boundsOverlap(a, unionBounds(a, b))).toBe(true);
    const off = (dx: number, dy: number, dz: number) => ({
      min: v3(dx - 1, dy - 1, dz - 1),
      max: v3(dx + 1, dy + 1, dz + 1),
    });
    for (const [dx, dy, dz] of [
      [3, 0, 0],
      [-3, 0, 0],
      [0, 3, 0],
      [0, -3, 0],
      [0, 0, 3],
      [0, 0, -3],
    ] as const) {
      expect(boundsOverlap(a, off(dx, dy, dz))).toBe(false);
    }
  });
});
