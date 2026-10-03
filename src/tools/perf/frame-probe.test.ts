import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERF_OPTIONS,
  FramePerfProbe,
  formatPerfReport,
  parsePerfParam,
  percentiles,
} from './frame-probe';

describe('?perf frame probe (mw-e00.21 AC-6)', () => {
  it('parses ?perf and ?perf=<seconds>', () => {
    expect(parsePerfParam('')).toBeUndefined();
    expect(parsePerfParam('?scene=testbed')).toBeUndefined();
    expect(parsePerfParam('?perf')).toEqual(DEFAULT_PERF_OPTIONS);
    expect(parsePerfParam('?perf=abc')).toEqual(DEFAULT_PERF_OPTIONS);
    expect(parsePerfParam('?perf=-3')).toEqual(DEFAULT_PERF_OPTIONS);
    expect(parsePerfParam('?scene=testbed&perf=30')).toEqual({ warmupMs: 2_000, sampleMs: 30_000 });
  });

  it('computes nearest-rank percentiles', () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i); // 1…100, unsorted
    expect(percentiles(samples)).toEqual({
      count: 100,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
      mean: 50.5,
    });
    expect(percentiles([7])).toMatchObject({ p50: 7, p95: 7, p99: 7, max: 7 });
    expect(percentiles([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 });
  });

  it('skips the warm-up, samples intervals and work, then reports exactly once', () => {
    const probe = new FramePerfProbe({ warmupMs: 100, sampleMs: 100 });
    const reports = [];
    // 10 ms frames from t = 0 to 250 ms, each doing 2 ms of work (3 ms from 150 ms).
    for (let t = 0; t <= 250; t += 10) {
      const report = probe.frame(t, t >= 150 ? 3 : 2);
      if (report !== undefined) reports.push(report);
    }
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report?.frame).toMatchObject({ count: 10, p50: 10, p95: 10 });
    expect(report?.work).toMatchObject({ count: 10, p50: 2, p95: 3, max: 3 });
    expect(formatPerfReport(report ?? { frame: percentiles([]), work: percentiles([]) })).toBe(
      '[perf] 10 frames · frame p50 10.00 / p95 10.00 / p99 10.00 / max 10.00 ms · ' +
        'work p50 2.00 / p95 3.00 / p99 3.00 ms',
    );
  });

  it('without a warm-up, the first frame has no interval yet', () => {
    const probe = new FramePerfProbe({ warmupMs: 0, sampleMs: 20 });
    probe.frame(0, 1);
    probe.frame(10, 1);
    const report = probe.frame(20, 1);
    expect(report?.frame.count).toBe(1);
    expect(report?.work.count).toBe(2);
    expect(probe.frame(30, 1)).toBeUndefined();
  });

  it('uses the default options', () => {
    const probe = new FramePerfProbe();
    expect(probe.frame(0, 1)).toBeUndefined();
    expect(probe.frame(12_000, 1)).toBeDefined();
  });

  it('mw-e32.1: parses the frame count and warm-up the perf suite asks for', () => {
    expect(parsePerfParam('?perf&perfFrames=1800&perfWarmup=3')).toEqual({
      warmupMs: 3_000,
      sampleMs: 10_000,
      frames: 1800,
    });
    expect(parsePerfParam('?perf=120&perfFrames=10.2&perfWarmup=0')).toEqual({
      warmupMs: 2_000,
      sampleMs: 120_000,
      frames: 11,
    });
    expect(parsePerfParam('?perf&perfFrames=&perfWarmup=x')).toEqual(DEFAULT_PERF_OPTIONS);
  });

  it('mw-e32.1: stops after the frame count, reporting the raw intervals and the window', () => {
    const probe = new FramePerfProbe({ warmupMs: 30, sampleMs: 10_000, frames: 3 });
    const reports = [];
    for (let t = 0; t <= 200; t += 10) {
      const report = probe.frame(t + 0.0004, 1);
      if (report !== undefined) reports.push(report);
    }
    expect(reports).toHaveLength(1);
    expect(reports[0]?.samples).toEqual([10, 10, 10]);
    expect(reports[0]?.frame.count).toBe(3);
    expect(reports[0]?.window).toEqual({ startMs: 30.0004, endMs: 60.0004 });
  });

  it('mw-e32.1: the sampling time still caps a frame-count run', () => {
    const probe = new FramePerfProbe({ warmupMs: 0, sampleMs: 25, frames: 1_000 });
    let report;
    for (let t = 0; t <= 40 && report === undefined; t += 10) report = probe.frame(t, 1);
    expect(report?.samples).toEqual([10, 10]);
  });
});
