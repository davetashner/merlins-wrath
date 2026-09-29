// mw-e29.1 AC-7 (CPU side): 50 simultaneous effects at the High particle cap must fit the frame. The
// frame-time p95 ≤ 16.7 ms on the reference machine is measured in the browser by the opt-in
// e2e/vfx-perf.spec.ts; this gates the runtime's own per-frame work (particle simulation plus filling
// the instance buffers) in Node, where tinybench reports p99, stricter than p95. Budget: 1 ms per
// frame, half the style bible's ≈ 2 ms VFX allocation (§13), leaving the rest to the GPU upload and
// draw. It is also measured at the 4000-particle cap the bead's description names, for headroom.
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import { VFX_PARTICLE_CAPS, VfxSystem } from '@game/vfx/index';
import { STRESS_EFFECT, VfxDemo } from '@tools/vfx-demo/index';

const BUDGET_MS = 1;
const CAMERA = { x: 0, y: 1.7, z: 8 };
const DT = 1 / 60;

function stressed(cap: number): VfxSystem {
  const effects = loadGameContent().all('vfx-effect');
  const vfx = new VfxSystem({ effects, dev: false, caps: { high: cap, low: cap } });
  const demo = new VfxDemo(vfx, 'stress', { x: 0, y: 0, z: 0 });
  // Two copies per slot fill a doubled cap too.
  if (cap > VFX_PARTICLE_CAPS.high) new VfxDemo(vfx, 'stress', { x: 0, y: 0, z: 1 });
  expect(demo.running).toBe(50);
  for (let i = 0; i < 180; i++) vfx.update(DT, CAMERA); // reach steady state
  return vfx;
}

describe('vfx system', () => {
  test(`AC-7: update() with 50 ${STRESS_EFFECT} effects at the High cap stays ≤ 1 ms per frame p95`, async ({
    bench,
  }) => {
    const vfx = stressed(VFX_PARTICLE_CAPS.high);
    expect(vfx.stats().reserved).toBe(VFX_PARTICLE_CAPS.high);
    expect(vfx.stats().particles).toBeGreaterThan(VFX_PARTICLE_CAPS.high * 0.75);
    const result = await bench('VfxSystem.update() at 2000', () => {
      vfx.update(DT, CAMERA);
    }).run();
    expect(result.latency.p99).toBeLessThanOrEqual(BUDGET_MS);
  });

  test('update() with 100 effects at a 4000-particle cap stays ≤ 2 ms per frame p95', async ({
    bench,
  }) => {
    const vfx = stressed(4000);
    expect(vfx.stats().reserved).toBe(4000);
    const result = await bench('VfxSystem.update() at 4000', () => {
      vfx.update(DT, CAMERA);
    }).run();
    expect(result.latency.p99).toBeLessThanOrEqual(2 * BUDGET_MS);
  });
});
