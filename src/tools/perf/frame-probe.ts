// Frame-time probe for ?perf (mw-e00.21 AC-6). After a warm-up it samples every rendered frame for a
// while and reports percentiles of two numbers: the frame interval (time between frames, what the
// player feels; capped by vsync unless the browser runs with vsync off) and the frame's own work (sim
// steps + render submission on the main thread). The official AC-6 measurement is headed Chrome on
// the reference machine (see e2e/perf.spec.ts); headless numbers are only indicative.

export interface PerfOptions {
  /** Frames in the first `warmupMs` are not sampled (shader compiles, JIT, first uploads). */
  readonly warmupMs: number;
  readonly sampleMs: number;
}

export const DEFAULT_PERF_OPTIONS: PerfOptions = Object.freeze({
  warmupMs: 2_000,
  sampleMs: 10_000,
});

/** `?perf` → default options; `?perf=20` → sample for 20 s; no parameter → undefined (probe off). */
export function parsePerfParam(search: string): PerfOptions | undefined {
  const value = new URLSearchParams(search).get('perf');
  if (value === null) return undefined;
  const seconds = Number(value);
  return value !== '' && Number.isFinite(seconds) && seconds > 0
    ? { ...DEFAULT_PERF_OPTIONS, sampleMs: seconds * 1_000 }
    : DEFAULT_PERF_OPTIONS;
}

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

export interface PerfReport {
  /** Time between consecutive frames, ms. */
  readonly frame: Percentiles;
  /** Main-thread work per frame (sim + render submit), ms. */
  readonly work: Percentiles;
}

const ms = (n: number): string => n.toFixed(2);

/** One line for the console, e.g. `[perf] 600 frames · frame p50 8.33 / p95 8.40 … ms`. */
export function formatPerfReport({ frame, work }: PerfReport): string {
  return (
    `[perf] ${String(frame.count)} frames · frame p50 ${ms(frame.p50)} / p95 ${ms(frame.p95)} / ` +
    `p99 ${ms(frame.p99)} / max ${ms(frame.max)} ms · work p50 ${ms(work.p50)} / ` +
    `p95 ${ms(work.p95)} / p99 ${ms(work.p99)} ms`
  );
}

export class FramePerfProbe {
  private start: number | undefined;
  private previous: number | undefined;
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
    if (elapsed >= this.options.warmupMs) {
      if (elapsed >= this.options.warmupMs + this.options.sampleMs) {
        this.done = true;
        return { frame: percentiles(this.frames), work: percentiles(this.work) };
      }
      if (this.previous !== undefined) this.frames.push(nowMs - this.previous);
      this.work.push(workMs);
    }
    this.previous = nowMs;
    return undefined;
  }
}
