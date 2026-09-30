// mw-e03.15 AC-6: light sampling budget. 64 dynamic emitters (burning entities, gathered from the
// world every tick) over the greybox testbed's static geometry, and 500 samples per tick at positions
// that drift a little every tick (actors moving through the level). The bead's budget is ≤ 0.5 ms per
// tick p95 on the reference machine; this guards it in Node. Run with `pnpm bench`.
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  addProperties,
  installLightField,
  installStimuli,
  LightField,
  loadScene,
  placeEntity,
  registerSceneComponents,
  registerWorldProperties,
  World,
  type Vec3,
} from '@sim/index';

const EMITTERS = 64;
const SAMPLES = 500;

function litTestbed() {
  const content = loadGameContent();
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 1 }))),
  );
  const field = new LightField();
  installLightField(world, field);
  const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  const scene = loadScene(world, content.get('scene', 'testbed'), kit, field.statics);
  const min = { x: Infinity, z: Infinity };
  const max = { x: -Infinity, z: -Infinity };
  for (const piece of scene.layout.pieces) {
    min.x = Math.min(min.x, piece.min.x);
    min.z = Math.min(min.z, piece.min.z);
    max.x = Math.max(max.x, piece.max.x);
    max.z = Math.max(max.z, piece.max.z);
  }
  // Emitters on an 8 × 8 grid over the level, 1.5 m up, burning with the default fire light (8 m).
  for (let i = 0; i < EMITTERS; i++) {
    const entity = world.spawn();
    const x = min.x + ((i % 8) + 0.5) * ((max.x - min.x) / 8);
    const z = min.z + (Math.floor(i / 8) + 0.5) * ((max.z - min.z) / 8);
    placeEntity(world, entity, { x, y: 1.5, z }, 0.3);
    addProperties(world, entity, { flammable: true, burning: true });
  }
  // Sample positions spread over the level at chest height (a deterministic scatter).
  const samples: Vec3[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    samples.push({
      x: min.x + (((i * 7919) % 1000) / 1000) * (max.x - min.x),
      y: 0.5 + ((i * 31) % 15) / 10,
      z: min.z + (((i * 104_729) % 997) / 997) * (max.z - min.z),
    });
  }
  return { world, field, samples, scene };
}

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

describe('light field', () => {
  test('AC-6: 64 dynamic emitters and 500 samples per tick stay ≤ 0.5 ms p95', async ({
    bench,
  }) => {
    const { world, field, samples, scene } = litTestbed();
    expect(field.statics.count()).toBeGreaterThan(0);
    expect(scene.pieces.length).toBeGreaterThan(0);
    let tick = 0;
    let sink = 0;
    const tickOnce = () => {
      field.update(world);
      const drift = ((tick++ % 120) - 60) / 60; // ±1 m over two seconds
      for (const p of samples) sink += field.levelAt({ x: p.x + drift, y: p.y, z: p.z - drift });
    };
    // tinybench reports p75 and p99 but not p95, so after its run (which also warms the JIT and
    // the baked cells) 4000 more ticks are timed one by one and every sample is kept.
    const result = await bench('update + 500 samples', tickOnce).run();
    const times: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const start = performance.now();
      tickOnce();
      times.push(performance.now() - start);
    }
    const tickP95 = p95(times);
    console.info(
      `light field: mean ${result.latency.mean.toFixed(4)} ms, p95 ${tickP95.toFixed(4)} ms per tick over ${String(times.length)} ticks`,
    );
    expect(field.emitterCount).toBe(EMITTERS);
    expect(sink).toBeGreaterThan(0);
    expect(result.latency.mean).toBeLessThanOrEqual(0.5); // milliseconds
    expect(tickP95).toBeLessThanOrEqual(0.5);
  });
});
