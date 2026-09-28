// mw-e00.28 AC-3: 1,000,000 simMath.sin + simMath.cos calls take no more than 3× the time of the same
// calls to Math.sin/Math.cos. Both run in the same process, back to back, so the check compares
// ratios rather than absolute times and holds on slow CI runners. Run with `pnpm bench`.
import { describe, expect, test } from 'vitest';
import { Rng, simMath } from '@sim/index';

const CALLS = 1_000_000;
// Gameplay angles: headings and arcs within a few turns, which exercises both the direct kernel and
// the medium-range reduction.
const rng = Rng.create(28).stream('angles');
const angles = Float64Array.from({ length: CALLS }, () => (rng.float() - 0.5) * 16 * Math.PI);

// Bind once: Vitest's benchmark mode counts every module-export getter access, which would otherwise
// dominate the measurement (production bundles have no such getters).
const { sin, cos } = simMath;

let sink = 0;

describe('sim math', () => {
  test('AC-3: 1,000,000 simMath.sin + cos calls take ≤ 3× Math.sin + cos', async ({ bench }) => {
    const engine = await bench('Math.sin + Math.cos', () => {
      let acc = 0;
      for (const a of angles) acc += Math.sin(a) + Math.cos(a);
      sink += acc;
    }).run();
    const portable = await bench('simMath.sin + simMath.cos', () => {
      let acc = 0;
      for (const a of angles) acc += sin(a) + cos(a);
      sink += acc;
    }).run();
    expect(Number.isFinite(sink)).toBe(true);
    expect(portable.latency.mean / engine.latency.mean).toBeLessThanOrEqual(3);
  });
});
