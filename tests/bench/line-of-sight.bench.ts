// mw-e09.1 AC-6: 24 observers × 4 samples of line of sight, batched, p95 ≤ 0.3 ms per tick. Measured
// in Node on the sim's Rapier world holding the greybox testbed (tinybench reports p99, which is
// stricter than p95), with two smoke volumes in play. Run with `pnpm bench`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  LineOfSight,
  loadScene,
  partial,
  RapierPhysics,
  RapierSightWorld,
  registerSceneComponents,
  World,
  type OcclusionVolume,
  type SightQuery,
} from '@sim/index';

const OBSERVERS = 24;

function testbed() {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = registerSceneComponents(new World({ seed: 1, physics }));
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  loadScene(world, content.get('scene', 'testbed'), kit, physics);
  world.step();
  return physics;
}

describe('line of sight', () => {
  test('AC-6: 24 observers × 4 samples, batched, stays ≤ 0.3 ms per tick p95', async ({
    bench,
  }) => {
    const physics = testbed();
    expect(physics.count()).toBeGreaterThan(0);
    const los = new LineOfSight({ world: new RapierSightWorld(physics) });
    const queries: SightQuery[] = Array.from({ length: OBSERVERS }, (_, i) => {
      const angle = (2 * Math.PI * i) / OBSERVERS;
      return {
        eye: { x: 12 * Math.cos(angle), y: 1.7, z: 12 * Math.sin(angle) },
        target: { feet: { x: (i % 5) - 2, y: 0, z: (i % 3) - 1 }, height: i % 2 === 0 ? 1.8 : 1.2 },
      };
    });
    const volumes: OcclusionVolume[] = [
      { kind: 'sphere', center: { x: 4, y: 1, z: 0 }, radius: 2, occlusion: partial(0.5) },
      {
        kind: 'box',
        min: { x: -6, y: 0, z: -2 },
        max: { x: -4, y: 2, z: 2 },
        occlusion: partial(0.4),
      },
    ];
    const out: number[] = [];
    const result = await bench('LineOfSight.visibleFractions (24 × 4)', () => {
      los.visibleFractions(queries, { volumes }, out);
    }).run();
    expect(out).toHaveLength(OBSERVERS);
    expect(result.latency.p99).toBeLessThanOrEqual(0.3); // milliseconds
  });
});
