// Frame-time probe for ?perf (mw-e00.21 AC-6). After a warm-up it samples every rendered frame for a
// while and reports percentiles of two numbers: the frame interval (time between frames, what the
// player feels; capped by vsync unless the browser runs with vsync off) and the frame's own work (sim
// steps + render submission on the main thread). The official AC-6 measurement is headed Chrome on
// the reference machine (see e2e/perf.spec.ts); headless numbers are only indicative.
//
// The perf budget suite (mw-e32.1, e2e/perf) asks for a frame count instead of a time: with
// `?perf&perfFrames=1800&perfWarmup=3` sampling ends after 1,800 frame intervals that follow a 3 s
// warm-up (or when the sampling time runs out first), and the report carries the raw intervals and
// the sampling window so the suite can compute its own percentiles and count long tasks in it.

import { percentiles, type Percentiles } from './percentiles';

export { percentiles, type Percentiles };

export interface PerfOptions {
  /** Frames in the first `warmupMs` are not sampled (shader compiles, JIT, first uploads). */
  readonly warmupMs: number;
  readonly sampleMs: number;
  /** Stop after this many frame intervals (sampleMs then only caps the time); none: time only. */
  readonly frames?: number;
}

export const DEFAULT_PERF_OPTIONS: PerfOptions = Object.freeze({
  warmupMs: 2_000,
  sampleMs: 10_000,
});

/** A positive number from a query parameter, or undefined when absent or not positive. */
function positive(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * `?perf` → default options; `?perf=20` → sample for 20 s; no parameter → undefined (probe off).
 * `&perfFrames=1800` stops after that many frame intervals; `&perfWarmup=3` sets the warm-up in
 * seconds (mw-e32.1).
 */
export function parsePerfParam(search: string): PerfOptions | undefined {
  const params = new URLSearchParams(search);
  const value = params.get('perf');
  if (value === null) return undefined;
  const seconds = positive(value);
  const frames = positive(params.get('perfFrames'));
  const warmup = positive(params.get('perfWarmup'));
  return {
    ...DEFAULT_PERF_OPTIONS,
    ...(seconds !== undefined && { sampleMs: seconds * 1_000 }),
    ...(warmup !== undefined && { warmupMs: warmup * 1_000 }),
    ...(frames !== undefined && { frames: Math.ceil(frames) }),
  };
}

export interface PerfReport {
  /** Time between consecutive frames, ms. */
  readonly frame: Percentiles;
  /** Main-thread work per frame (sim + render submit), ms. */
  readonly work: Percentiles;
  /** Every sampled frame interval in order, ms (rounded to 0.001 ms). */
  readonly samples: readonly number[];
  /** The sampling window on the page's performance clock, ms: after the warm-up to the end. */
  readonly window: { readonly startMs: number; readonly endMs: number };
}

const ms = (n: number): string => n.toFixed(2);

/** One line for the console, e.g. `[perf] 600 frames · frame p50 8.33 / p95 8.40 … ms`. */
export function formatPerfReport({ frame, work }: Pick<PerfReport, 'frame' | 'work'>): string {
  return (
    `[perf] ${String(frame.count)} frames · frame p50 ${ms(frame.p50)} / p95 ${ms(frame.p95)} / ` +
    `p99 ${ms(frame.p99)} / max ${ms(frame.max)} ms · work p50 ${ms(work.p50)} / ` +
    `p95 ${ms(work.p95)} / p99 ${ms(work.p99)} ms`
  );
}

export class FramePerfProbe {
  private start: number | undefined;
  private previous: number | undefined;
  private windowStart: number | undefined;
  private readonly frames: number[] = [];
  private readonly work: number[] = [];
  private done = false;

  constructor(private readonly options: PerfOptions = DEFAULT_PERF_OPTIONS) {}

  /**
   * Records one frame that started at `nowMs` and whose work took `workMs`. Returns the report on the
   * first frame after sampling ends, and undefined before and after that.
   */
  frame(nowMs: number, workMs: number): PerfReport | undefined {
    if (this.done) return undefined;
    this.start ??= nowMs;
    const elapsed = nowMs - this.start;
    const { warmupMs, sampleMs, frames } = this.options;
    if (elapsed >= warmupMs) {
      this.windowStart ??= nowMs;
      const enough = frames !== undefined && this.frames.length >= frames;
      if (enough || elapsed >= warmupMs + sampleMs) {
        this.done = true;
        return {
          frame: percentiles(this.frames),
          work: percentiles(this.work),
          samples: this.frames.map((n) => Math.round(n * 1_000) / 1_000),
          window: { startMs: this.windowStart, endMs: nowMs },
        };
      }
      if (this.previous !== undefined) this.frames.push(nowMs - this.previous);
      this.work.push(workMs);
    }
    this.previous = nowMs;
    return undefined;
  }
}
