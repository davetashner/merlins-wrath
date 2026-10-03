import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { referencePercentile } from '../../../tests/perf/percentile-reference';
import { frameTimeStats, MIN_FRAME_SAMPLES, percentiles } from './percentiles';

// mw-e32.1 AC-3: the suite's percentiles agree with the committed reference implementation, and a
// short run is an "insufficient samples" failure, never a pass.
describe('frame-time percentiles (mw-e32.1)', () => {
  it('AC-3: p50/p95/p99 match the committed reference implementation on any samples', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1_000, noNaN: true }), { minLength: 1, maxLength: 400 }),
        (samples) => {
          const got = percentiles(samples);
          expect(got.p50).toBe(referencePercentile(samples, 50));
          expect(got.p95).toBe(referencePercentile(samples, 95));
          expect(got.p99).toBe(referencePercentile(samples, 99));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('AC-3: matches the reference on hand-checked fixtures', () => {
    // 1…1000 shuffled: the p-th percentile is p × 10.
    const thousand = Array.from({ length: 1_000 }, (_, i) => ((i * 7919) % 1_000) + 1);
    expect(percentiles(thousand)).toMatchObject({ p50: 500, p95: 950, p99: 990, max: 1_000 });
    expect(referencePercentile(thousand, 95)).toBe(950);
    // 300 frames at 16 ms with 15 hitches of 40 ms and 3 of 100 ms: p95 and p99 sit on the
    // 40 ms hitches; the three 100 ms frames are the top 1 %, above p99.
    const hitchy = [...Array<number>(282).fill(16), ...Array<number>(15).fill(40), 100, 100, 100];
    expect(percentiles(hitchy)).toMatchObject({ p50: 16, p95: 40, p99: 40, max: 100 });
    expect([50, 95, 99].map((p) => referencePercentile(hitchy, p))).toEqual([16, 40, 40]);
    expect(referencePercentile([], 50)).toBe(0);
    expect(referencePercentile([3, 1, 2], 100)).toBe(3);
  });

  it('AC-3: fewer than 300 samples is an "insufficient samples" failure, not a pass', () => {
    expect(MIN_FRAME_SAMPLES).toBe(300);
    const fast = Array<number>(299).fill(1);
    expect(frameTimeStats(fast)).toEqual({ ok: false, reason: 'insufficient samples', count: 299 });
    expect(frameTimeStats([])).toEqual({ ok: false, reason: 'insufficient samples', count: 0 });
    const enough = frameTimeStats([...fast, 1]);
    expect(enough.ok && enough.stats.count).toBe(300);
    expect(frameTimeStats([5, 6], 2)).toMatchObject({ ok: true, stats: { p50: 5 } });
  });
});
