// mw-e03.10 AC-6: 200 active physics objects in the greybox testbed, physics step ≤ 2.0 ms per tick
// p95 on the reference machine (backlog contract: M1 Pro). Measured in Node on the sim-owned Rapier
// world: the whole World.step() with the physics-object system (pose copy, placements, impacts,
// budget), so the figure includes this layer's own cost on top of Rapier's. 200 crates tumble in the
// arena and get kicked every 0.5 s so they never fall asleep; tinybench reports p75 and p99 but not
// p95, so the bench times each tick itself. Run with `pnpm bench`.
// The p95 is taken over a fixed number of ticks after a warm-up (mw-w3d): timing the tinybench run
// itself mixed JIT warm-up and the initial pile settling into the samples, and a slower runner took
// fewer samples, so those outliers plus the kicked ticks (one in 30, about twice a normal tick's
// cost) filled the top 5% and the p95 jumped from normal ticks to kicked ones.
// On the reference class (Apple silicon) it measures about 0.8 ms; the same budget is asserted on CI.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  addPhysicsObject,
  addProperties,
  installPhysicsObjects,
  installStimuli,
  loadScene,
  PhysicsObjectComponent,
  RapierPhysics,
  registerSceneComponents,
  registerWorldProperties,
  World,
  type ColliderHandle,
  type EntityId,
} from '@sim/index';

const BODIES = 200;
/** The AC-6 budget, milliseconds per tick. */
const BUDGET_MS = 2.0;
/** Ticks between kicks that keep every body awake. */
const KICK_EVERY = 30;
/** Ticks timed after the warm-up: 100 kick cycles. */
const TIMED_TICKS = 100 * KICK_EVERY;

function arena() {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 1, physics }))),
  );
  installPhysicsObjects(world);
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  loadScene(world, content.get('scene', 'testbed'), kit, physics);
  // The arena floor spans x −8…8, z 15…31: a 10 × 10 grid, two layers.
  const bodies: EntityId[] = Array.from({ length: BODIES }, (_, i) => {
    const entity = world.spawn();
    addProperties(world, entity, { material: 'wood', weight: 5 + (i % 7), impactAbsorb: 0.1 });
    addPhysicsObject(world, entity, {
      shape:
        i % 3 === 0
          ? { kind: 'sphere', radius: 0.2 }
          : { kind: 'box', halfExtents: { x: 0.2, y: 0.2, z: 0.2 } },
      position: {
        x: -6 + (i % 10) * 1.3,
        y: 1 + Math.floor(i / 100) * 1.5,
        z: 17 + (Math.floor(i / 10) % 10) * 1.3,
      },
    });
    return entity;
  });
  return { world, physics, bodies };
}

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

describe('physics objects', () => {
  test('AC-6: 200 active bodies in the greybox testbed step in ≤ 2.0 ms per tick p95', async ({
    bench,
  }) => {
    const { world, physics, bodies } = arena();
    const handles = bodies.map(
      (entity) => world.get(entity, PhysicsObjectComponent)?.body as ColliderHandle,
    );
    const kick = (tick: number): void => {
      handles.forEach((handle, i) => {
        const angle = (i * 2.399963 + tick) % (2 * Math.PI);
        physics.applyImpulse(handle, { x: 8 * Math.cos(angle), y: 25, z: 8 * Math.sin(angle) });
      });
    };
    let awakeMin = BODIES;
    /** Before a tick: kick every body at the start of each cycle. */
    const before = (): void => {
      if (world.tick % KICK_EVERY === 0) kick(world.tick);
    };
    /** After a tick: at the end of each cycle, count the bodies still awake. */
    const after = (): void => {
      if (world.tick % KICK_EVERY === KICK_EVERY - 1) {
        const awake = bodies.filter(
          (e) => world.get(e, PhysicsObjectComponent)?.sleeping === false,
        );
        awakeMin = Math.min(awakeMin, awake.length);
      }
    };
    // tinybench's run is the warm-up: it tiers up the JIT and lets the initial pile settle, and
    // how many ticks it manages depends on the runner. Its samples are discarded; then a fixed
    // TIMED_TICKS ticks are timed one by one (only World.step(), not the kicks) and every sample is
    // kept, so each runner's p95 is over the same workload (exactly one kicked tick in KICK_EVERY).
    const result = await bench('World.step() with 200 active physics objects', () => {
      before();
      world.step();
      after();
    }).run();
    const samples: number[] = [];
    for (let i = 0; i < TIMED_TICKS; i++) {
      before();
      const start = performance.now();
      world.step();
      samples.push(performance.now() - start);
      after();
    }
    const tickP95 = p95(samples);
    console.info(
      `physics objects ×${String(BODIES)}: mean ${result.latency.mean.toFixed(4)} ms, p95 ${tickP95.toFixed(4)} ms per tick over ${String(samples.length)} ticks; fewest awake ${String(awakeMin)}`,
    );
    expect(awakeMin).toBe(BODIES); // every body stayed active
    expect(tickP95).toBeLessThanOrEqual(BUDGET_MS); // milliseconds
  });
});
