// The Rapier SightWorld (mw-e09.1) against the shared contract, plus line of sight on real physics.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { World } from '../core/world';
import { LineOfSight } from '../sight/line-of-sight';
import { describeSightWorldContract } from '../sight/sight-world.contract';
import type { Vec3 } from '../stimulus/shapes';
import { RapierPhysics } from './rapier';
import { RapierSightWorld } from './rapier-sight-world';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describeSightWorldContract('RapierSightWorld', (boxes) => {
  const physics = new RapierPhysics(RAPIER);
  const bodies = boxes.map((shape) => physics.add(shape));
  physics.step(0); // bring scene queries up to date without moving anything
  return { world: new RapierSightWorld(physics), bodies };
});

describe('RapierSightWorld (mw-e09.1)', () => {
  it('a closing door (a kinematic collider) cuts line of sight as it moves into place', () => {
    const physics = new RapierPhysics(RAPIER);
    // A 1 m wide door slab at z 1…2, sliding towards -z at 1 m/s across the sight line along z = 0.
    physics.add({ ...box(v(4, 0, 1), v(4.2, 3, 2)), velocity: v(0, 0, -1) });
    const world = new World({ seed: 1, physics, hz: 10 });
    const los = new LineOfSight({ world: new RapierSightWorld(physics) });
    const target = { feet: v(8, 0, 0), height: 1.8 };
    physics.step(0);
    expect(los.visibleFraction(v(0, 1.7, 0), target)).toBe(1);
    for (let tick = 0; tick < 15; tick++) world.step();
    expect(los.visibleFraction(v(0, 1.7, 0), target)).toBe(0);
  });
});
