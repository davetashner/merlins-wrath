import { describe, expect, it } from 'vitest';
import { horizontalAim, pointToWorld, rotateToWorld, shapeToWorld } from './frame';

const FORWARD = { x: 0, y: 0, z: 1 };
const EAST = { x: 1, y: 0, z: 0 };
const origin = { x: 10, y: 0, z: -2 };

describe('attacker frame', () => {
  it('normalizes the aim to a horizontal unit vector and refuses one with no direction', () => {
    expect(horizontalAim({ x: 3, y: 9, z: 4 })).toEqual({ x: 0.6, y: 0, z: 0.8 });
    expect(() => horizontalAim({ x: 0, y: 1, z: 0 })).toThrow(RangeError);
    expect(() => horizontalAim({ x: Number.NaN, y: 0, z: 1 })).toThrow(RangeError);
  });

  it('facing +z is the identity rotation; facing +x turns forward to +x and right to −z', () => {
    const v = { x: 1, y: 2, z: 3 };
    expect(rotateToWorld(v, FORWARD)).toEqual(v);
    expect(rotateToWorld({ x: 0, y: 0, z: 1 }, EAST)).toEqual({ x: 1, y: 0, z: 0 });
    expect(rotateToWorld({ x: 1, y: 0, z: 0 }, EAST)).toEqual({ x: 0, y: 0, z: -1 });
    expect(pointToWorld({ x: 0, y: 1, z: 2 }, origin, EAST)).toEqual({ x: 12, y: 1, z: -2 });
  });

  it('places spheres, capsules and boxes; a turned box grows to the enclosing axis-aligned box', () => {
    expect(
      shapeToWorld({ kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 }, origin, EAST),
    ).toEqual({ kind: 'sphere', center: { x: 11, y: 1, z: -2 }, radius: 0.5 });
    expect(
      shapeToWorld(
        { kind: 'capsule', from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 1, z: 2 }, radius: 0.2 },
        origin,
        EAST,
      ),
    ).toEqual({
      kind: 'capsule',
      from: { x: 10, y: 1, z: -2 },
      to: { x: 12, y: 1, z: -2 },
      radius: 0.2,
    });
    const box = {
      kind: 'box',
      center: { x: 0, y: 1, z: 1 },
      halfExtents: { x: 1, y: 0.5, z: 2 },
    } as const;
    expect(shapeToWorld(box, origin, EAST)).toEqual({
      kind: 'box',
      center: { x: 11, y: 1, z: -2 },
      halfExtents: { x: 2, y: 0.5, z: 1 },
    });
    const diagonal = shapeToWorld(box, origin, horizontalAim({ x: 1, y: 0, z: 1 }));
    expect(diagonal.kind === 'box' && diagonal.halfExtents.x).toBeCloseTo(3 / Math.SQRT2);
  });
});
