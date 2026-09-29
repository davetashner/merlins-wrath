// The SightWorld contract (mw-e09.1) as a reusable Vitest suite: the in-memory fake
// (fake-sight-world.test.ts) and the Rapier port (rapier-sight-world.test.ts) both run it against the
// same greybox boxes, so line of sight answers the same on both. Contacts exactly on a face are not
// pinned (Rapier works in 32-bit floats).
//
// Test-only: imports vitest, so it is not exported from index.ts.

import { describe, expect, it } from 'vitest';
import type { BodyId } from '../character/collision-world';
import { box, type GreyboxBox } from '../character/greybox';
import type { Vec3 } from '../stimulus/shapes';
import type { SightWorld } from './sight-world';

/** A SightWorld holding exactly `boxes`, with each box's body id in the same order. */
export type MakeSightWorld = (boxes: readonly GreyboxBox[]) => {
  readonly world: SightWorld;
  readonly bodies: readonly BodyId[];
};

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Two 1 m thick walls across the x axis, at x 2…3 and x 5…6. */
const NEAR = box(v(2, 0, -5), v(3, 3, 5));
const FAR = box(v(5, 0, -5), v(6, 3, 5));

function crossings(world: SightWorld, from: Vec3, to: Vec3): BodyId[] {
  const seen: BodyId[] = [];
  world.forEachCrossing(from, to, (body) => {
    seen.push(body);
    return true;
  });
  return seen.sort((a, b) => a - b);
}

export function describeSightWorldContract(name: string, make: MakeSightWorld): void {
  describe(`SightWorld contract: ${name}`, () => {
    it('visits every collider the segment crosses, each once', () => {
      const { world, bodies } = make([NEAR, FAR]);
      expect(crossings(world, v(0, 1, 0), v(8, 1, 0))).toEqual([...bodies].sort((a, b) => a - b));
    });

    it('does not visit colliders beyond either end or off to the side', () => {
      const { world, bodies } = make([NEAR, FAR]);
      expect(crossings(world, v(0, 1, 0), v(4, 1, 0))).toEqual([bodies[0]]);
      expect(crossings(world, v(0, 4, 0), v(8, 4, 0))).toEqual([]);
      expect(crossings(world, v(3.5, 1, 0), v(4.5, 1, 0))).toEqual([]);
    });

    it('visits a collider that contains the start of the segment', () => {
      const { world, bodies } = make([NEAR]);
      expect(crossings(world, v(2.5, 1, 0), v(0, 1, 0))).toEqual([bodies[0]]);
    });

    it('names the collider nearest the start, or none', () => {
      const { world, bodies } = make([FAR, NEAR]);
      expect(world.firstCrossing(v(0, 1, 0), v(8, 1, 0))).toBe(bodies[1]);
      expect(world.firstCrossing(v(8, 1, 0), v(0, 1, 0))).toBe(bodies[0]);
      expect(world.firstCrossing(v(2.5, 1, 0), v(8, 1, 0))).toBe(bodies[1]);
      expect(world.firstCrossing(v(0, 1, 0), v(1.5, 1, 0))).toBeUndefined();
    });

    it('stops when the visitor returns false', () => {
      const { world } = make([NEAR, FAR]);
      let visits = 0;
      world.forEachCrossing(v(0, 1, 0), v(8, 1, 0), () => {
        visits++;
        return false;
      });
      expect(visits).toBe(1);
    });
  });
}
