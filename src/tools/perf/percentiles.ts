// Percentiles of frame-time samples (mw-e00.21, mw-e32.1). Shared by the in-page ?perf probe and the
// Node side of the perf budget suite (scripts/perf, e2e/perf), so it stays plain TypeScript with no
// imports: Node runs the suite's scripts with type stripping only.
//
// Nearest-rank definition: the p-th percentile of n sorted samples is the sample at rank ⌈p/100 · n⌉
// (1-based). tests/perf/percentile-reference.ts is the committed reference implementation it must
// match (mw-e32.1 AC-3).

export interface Percentiles {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/** Nearest-rank percentiles of `samples` (all zero for no samples). */
export function percentiles(samples: readonly number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const rank = (p: number): number => sorted[Math.max(0, Math.ceil((p / 100) * count) - 1)] ?? 0;
  const sum = sorted.reduce((total, n) => total + n, 0);
  return {
    count,
    p50: rank(50),
    p95: rank(95),
    p99: rank(99),
    max: sorted.at(-1) ?? 0,
    mean: count === 0 ? 0 : sum / count,
  };
}

/**
 * Fewest samples a frame-time percentile may be judged on (mw-e32.1 AC-3): with fewer, p99 rests on
 * two or three frames and a budget pass means nothing.
 */
export const MIN_FRAME_SAMPLES = 300;

/** Frame-time statistics, or why there are none. */
export type FrameTimeStats =
  | { readonly ok: true; readonly stats: Percentiles }
  | { readonly ok: false; readonly reason: 'insufficient samples'; readonly count: number };

/**
 * Percentiles of `samples`, or an "insufficient samples" failure when there are fewer than
 * `minSamples` (MIN_FRAME_SAMPLES by default): a short run fails rather than passes.
 */
export function frameTimeStats(
  samples: readonly number[],
  minSamples: number = MIN_FRAME_SAMPLES,
): FrameTimeStats {
  if (samples.length < minSamples) {
    return { ok: false, reason: 'insufficient samples', count: samples.length };
  }
  return { ok: true, stats: percentiles(samples) };
}
