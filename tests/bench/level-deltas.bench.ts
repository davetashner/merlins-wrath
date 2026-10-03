// mw-e27.3 AC-6: applying 5,000 entity deltas on level load takes ≤ 30 ms on the reference machine
// (backlog contract: M1 Pro). The level is 5,000 authored entities on the sim-owned Rapier world:
// 1,000 crates (physics objects) moved and at rest, 1,500 things broken or burnt away and 2,500 whose
// properties changed (charred, soaked through, emptied of fuel). Each timed run applies the deltas to
// a freshly spawned level, as a load does; spawning and the baseline are not timed. Run with
// `pnpm bench`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import {
  addPhysicsObject,
  addProperties,
  installPhysicsObjects,
  installStimuli,
  RapierPhysics,
  registerPersistence,
  registerWorldProperties,
  World,
  WorldPersistence,
  type EntityId,
  type LevelDeltas,
} from '@sim/index';

const DELTAS = 5000;
const CRATES = 1000;
const GONE = 1500;
/** The AC-6 budget, milliseconds per load. */
const BUDGET_MS = 30;
const WARM_UP = 3;
const RUNS = 10;

const persistence = new WorldPersistence();

/** A freshly spawned level of DELTAS authored entities and its baseline. */
function level() {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1, physics })));
  installPhysicsObjects(world);
  registerPersistence(world);
  const authored: [string, EntityId][] = [];
  for (let i = 0; i < DELTAS; i++) {
    const entity = world.spawn();
    addProperties(world, entity, { material: 'wood', weight: 5, flammable: true, fuel: 20 });
    if (i < CRATES) {
      addPhysicsObject(world, entity, {
        shape: { kind: 'box', halfExtents: { x: 0.25, y: 0.25, z: 0.25 } },
        position: { x: (i % 40) * 2, y: 0.25, z: Math.floor(i / 40) * 2 },
      });
    }
    authored.push([`spawn:thing-${String(i)}`, entity]);
  }
  return { world, baseline: persistence.baseline(world, 'stress', authored) };
}

const deltas: LevelDeltas = {
  level: 'stress',
  entities: Array.from({ length: DELTAS }, (_, i) => {
    const id = `spawn:thing-${String(i)}`;
    if (i < CRATES) {
      const position = { x: (i % 40) * 2 + 0.7, y: 0.25, z: Math.floor(i / 40) * 2 - 0.4 };
      return { id, aspects: { transform: { position, rotation: { x: 0, y: 0, z: 0, w: 1 } } } };
    }
    if (i < CRATES + GONE) return { id, destroyed: true as const };
    return { id, aspects: { properties: { material: 'charred', fuel: 0, flammable: null } } };
  }),
  spawned: [],
};

describe('level deltas', () => {
  test('AC-6: 5,000 deltas apply on level load in ≤ 30 ms', async ({ bench }) => {
    const samples: number[] = [];
    for (let run = 0; run < WARM_UP + RUNS; run++) {
      const { world, baseline } = level();
      const start = performance.now();
      const report = persistence.apply(world, baseline, deltas);
      const took = performance.now() - start;
      expect(report.applied).toBe(DELTAS);
      expect(report.skipped).toEqual([]);
      if (run >= WARM_UP) samples.push(took);
    }
    // Reported through tinybench too, for the benchmark table (one load per sample).
    const fresh = Array.from({ length: 4 }, level);
    await bench('apply 5,000 deltas', () => {
      const next = fresh.pop() ?? level();
      persistence.apply(next.world, next.baseline, deltas);
    }).run();
    const worst = Math.max(...samples);
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? Infinity;
    console.info(
      `level deltas ×${String(DELTAS)}: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms over ${String(RUNS)} loads`,
    );
    expect(median).toBeLessThanOrEqual(BUDGET_MS);
  });
});
