// mw-e09.1 AC-6: 24 observers × 4 samples of line of sight, batched, p95 ≤ 0.3 ms per tick on the
// reference machine (backlog contract: M1 Pro). Measured in Node on the sim's Rapier world holding
// the greybox testbed, with two smoke volumes in play. tinybench reports p75 and p99 but not p95, so
// the bench times each batch itself and takes the 95th percentile of those samples. Run with
// `pnpm bench`.
//
// Nearly all of the cost is Rapier's own per-ray JS↔WASM call (plus Vitest's module-runner export
// getters, which a bundled build does not pay), so CI's slower x64 runners cannot hold the reference
// budget. As in sim-math.bench.ts, the gate that holds on any runner is relative: the batch costs at
// most 1.5× the same 96 rays as bare Rapier `castRay` calls, i.e. line of sight adds little over the
// engine's floor. The absolute AC-6 budget is asserted off CI (a developer machine of the reference
// class); CI keeps a 2× ceiling that still catches a real regression.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  DEFAULT_SIGHT_SAMPLES,
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
/** The AC-6 budget, milliseconds per tick. */
const BUDGET_MS = 0.3;
const ON_CI = process.env['CI'] === 'true';

function testbed() {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = registerSceneComponents(new World({ seed: 1, physics }));
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  loadScene(world, content.get('scene', 'testbed'), kit, physics);
  world.step();
  return physics;
}

const queries: SightQuery[] = Array.from({ length: OBSERVERS }, (_, i) => {
  const angle = (2 * Math.PI * i) / OBSERVERS;
  return {
    eye: { x: 12 * Math.cos(angle), y: 1.7, z: 12 * Math.sin(angle) },
    target: { feet: { x: (i % 5) - 2, y: 0, z: (i % 3) - 1 }, height: i % 2 === 0 ? 1.8 : 1.2 },
  };
});

const volumes: OcclusionVolume[] = [
  { kind: 'sphere', center: { x: 4, y: 1, z: 0 }, radius: 2, occlusion: partial(0.5) },
  { kind: 'box', min: { x: -6, y: 0, z: -2 }, max: { x: -4, y: 2, z: 2 }, occlusion: partial(0.4) },
];

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

/** The same 96 sight lines as bare Rapier rays: origin, unit direction, length. */
function bareRays() {
  return queries.flatMap(({ eye, target }) =>
    DEFAULT_SIGHT_SAMPLES.map((fraction) => {
      const to = { ...target.feet, y: target.feet.y + target.height * fraction };
      const d = { x: to.x - eye.x, y: to.y - eye.y, z: to.z - eye.z };
      const length = Math.hypot(d.x, d.y, d.z);
      const dir = { x: d.x / length, y: d.y / length, z: d.z / length };
      return { ray: new RAPIER.Ray(eye, dir), length };
    }),
  );
}

describe('line of sight', () => {
  test('AC-6: 24 observers × 4 samples, batched, stays ≤ 0.3 ms per tick p95', async ({
    bench,
  }) => {
    const physics = testbed();
    expect(physics.count()).toBeGreaterThan(0);
    const los = new LineOfSight({ world: new RapierSightWorld(physics) });
    const rays = bareRays();
    const out: number[] = [];
    const floor = await bench('96 bare Rapier castRay calls', () => {
      for (const { ray, length } of rays) physics.rapierWorld.castRay(ray, length, true);
    }).run();
    const samples: number[] = [];
    const result = await bench('LineOfSight.visibleFractions (24 × 4)', () => {
      const start = performance.now();
      los.visibleFractions(queries, { volumes }, out);
      samples.push(performance.now() - start);
    }).run();
    expect(out).toHaveLength(OBSERVERS);
    expect(result.latency.mean).toBeLessThanOrEqual(1.5 * floor.latency.mean);
    const tickP95 = p95(samples);
    console.info(`line of sight 24 × 4: p95 ${tickP95.toFixed(4)} ms per tick`);
    expect(tickP95).toBeLessThanOrEqual(ON_CI ? 2 * BUDGET_MS : BUDGET_MS); // milliseconds
  });
});
