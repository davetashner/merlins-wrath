import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { Vec3 } from '../stimulus/shapes';
import { FakeSightWorld } from './fake-sight-world';
import { describeSightWorldContract } from './sight-world.contract';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describeSightWorldContract('FakeSightWorld', (boxes) => {
  const world = new FakeSightWorld();
  return { world, bodies: boxes.map((shape) => world.add(shape)) };
});

describe('FakeSightWorld (mw-e09.1)', () => {
  const crossed = (world: FakeSightWorld): number[] => {
    const seen: number[] = [];
    world.forEachCrossing(v(0, 1, 0), v(8, 1, 0), (body) => seen.push(body) > 0);
    return seen;
  };

  it('moves and removes colliders, never reusing ids', () => {
    const world = new FakeSightWorld([box(v(2, 0, -1), v(3, 3, 1))]);
    const door = world.add(box(v(4, 0, 2), v(4.2, 3, 3)));
    expect(crossed(world)).toEqual([1]);
    world.set(door, box(v(4, 0, -1), v(4.2, 3, 1)));
    expect(crossed(world)).toEqual([1, door]);
    world.remove(1);
    expect(crossed(world)).toEqual([door]);
    expect(world.firstCrossing(v(0, 1, 0), v(8, 1, 0))).toBe(door);
    expect(world.add(box(v(6, 0, -1), v(7, 3, 1)))).toBe(3);
  });

  it('rejects unknown or removed ids', () => {
    const world = new FakeSightWorld([box(v(0, 0, 0), v(1, 1, 1))]);
    world.remove(1);
    expect(() => {
      world.remove(1);
    }).toThrow(RangeError);
    expect(() => {
      world.set(2, box(v(0, 0, 0), v(1, 1, 1)));
    }).toThrow(/sight body 2/);
  });
});
