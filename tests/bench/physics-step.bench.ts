// mw-e03.35: the physics step's share of the sim tick for the greybox testbed (static level geometry
// in the sim-owned Rapier world, ADR-0001). World.step() with only physics attached measures what
// the port adds to every tick; the budget is the whole sim step's (mw-e00.15 AC-6: mean ≤ 1 ms),
// and static colliders should use a small fraction of it. Run with `pnpm bench`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import { loadScene, RapierPhysics, registerSceneComponents, World } from '@sim/index';

function testbedWorld() {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = registerSceneComponents(new World({ seed: 1, physics }));
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  loadScene(world, content.get('scene', 'testbed'), kit, physics);
  return { world, physics };
}

describe('physics step', () => {
  test('mw-e03.35: a sim tick with the testbed in the Rapier world averages well under 1 ms', async ({
    bench,
  }) => {
    const { world, physics } = testbedWorld();
    expect(physics.count()).toBeGreaterThan(0);
    const result = await bench('World.step() with testbed physics', () => {
      world.step();
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(0.25); // milliseconds
  });
});
