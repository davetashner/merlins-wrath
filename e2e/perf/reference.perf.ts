// The perf budget suite's reference mode (mw-e32.1 AC-1): `pnpm perf:ref`, run by hand on the
// reference machine (contract §1: MacBook Pro M1 Pro, 16 GB, Chrome current). Headed Chrome, uncapped
// (vsync and the frame-rate limit off) so the frame interval is real CPU + GPU throughput, a
// 1280×720 viewport at DPR 2 (a 2560×1440 drawing buffer: High, 1440p-equivalent), 1,800 frames
// after a 3 s warm-up. Enforces the absolute frame-time budgets and writes
// perf/results/<date>-<sha>.json (e2e/perf/reporter.ts) to be committed. The numbers mean nothing
// on another machine.
import { test } from '@playwright/test';
import {
  browserName,
  enforce,
  frameMeasurements,
  instrument,
  SAMPLE_FRAMES,
  sampleFrames,
} from './harness';

/** Most seconds of sampling; enough for 1,800 frames at 10 fps, so a slow run fails on budget. */
const FRAME_CAP_S = Number(process.env['PERF_FRAME_CAP_S'] ?? '180');

test('AC-1: perf-baseline at High, 1440p-equivalent: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
  page,
}, testInfo) => {
  test.setTimeout((FRAME_CAP_S + 120) * 1_000);
  await instrument(page);
  const sample = await sampleFrames(page, {
    scene: 'perf-baseline',
    capS: FRAME_CAP_S,
    minSamples: SAMPLE_FRAMES,
    viewport: '1280×720 @2x',
  });
  await enforce(testInfo, 'reference', {
    browser: browserName(page),
    frames: sample.run,
    measurements: frameMeasurements(sample),
  });
});
