// lint-as: src/sim/physics/fixture.ts
// expect: @typescript-eslint/no-restricted-imports
import * as RAPIER from '@dimforge/rapier3d-deterministic';
export const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
