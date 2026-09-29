// Body descriptions (mw-e03.10): validation and bounding spheres, engine-free.
import { describe, expect, it } from 'vitest';
import { boundingRadius, checkBodyDesc, type BodyDesc } from './bodies';

const CRATE: BodyDesc = {
  shape: { kind: 'box', halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  position: { x: 0, y: 1, z: 0 },
  mass: 10,
  friction: 0.5,
  restitution: 0.1,
};

describe('body descriptions (mw-e03.10)', () => {
  it('accepts a valid body with or without rotation and velocity', () => {
    expect(() => {
      checkBodyDesc(CRATE);
      checkBodyDesc({
        ...CRATE,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 1, y: 2, z: 3 },
      });
    }).not.toThrow();
  });

  it.each<[string, BodyDesc, string]>([
    [
      'a flat box',
      { ...CRATE, shape: { kind: 'box', halfExtents: { x: 1, y: 0, z: 1 } } },
      'box body sizes must be positive',
    ],
    [
      'a zero sphere',
      { ...CRATE, shape: { kind: 'sphere', radius: 0 } },
      'sphere body sizes must be positive',
    ],
    [
      'a capsule with an infinite radius',
      { ...CRATE, shape: { kind: 'capsule', halfHeight: 1, radius: Infinity } },
      'capsule body sizes must be positive',
    ],
    ['a massless body', { ...CRATE, mass: 0 }, 'body mass must be positive'],
    [
      'a NaN position',
      { ...CRATE, position: { x: NaN, y: 0, z: 0 } },
      'body numbers must be finite',
    ],
    [
      'an infinite rotation',
      { ...CRATE, rotation: { x: 0, y: Infinity, z: 0, w: 1 } },
      'body numbers must be finite',
    ],
    [
      'a NaN velocity',
      { ...CRATE, velocity: { x: 0, y: 0, z: NaN } },
      'body numbers must be finite',
    ],
    ['a NaN friction', { ...CRATE, friction: NaN }, 'body numbers must be finite'],
  ])('refuses %s', (_, desc, message) => {
    expect(() => {
      checkBodyDesc(desc);
    }).toThrow(new RangeError(message));
  });

  it('bounds each shape by a sphere around its centre', () => {
    expect(boundingRadius({ kind: 'box', halfExtents: { x: 1, y: 2, z: 2 } })).toBe(3);
    expect(boundingRadius({ kind: 'sphere', radius: 0.4 })).toBe(0.4);
    expect(boundingRadius({ kind: 'capsule', halfHeight: 0.5, radius: 0.25 })).toBe(0.75);
  });
});
