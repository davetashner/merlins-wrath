// The perf budget suite's reference mode (mw-e32.1 AC-1): `pnpm perf:ref`, run by hand on the
// reference machine (contract §1: MacBook Pro M1 Pro, 16 GB, Chrome current). Headed Chrome, uncapped
// (vsync and the frame-rate limit off) so the frame interval is real CPU + GPU throughput, a
// 1280×720 viewport at DPR 2 (a 2560×1440 drawing buffer: High, 1440p-equivalent), 1,800 frames
// after a 3 s warm-up. Enforces the absolute frame-time budgets and writes
// perf/results/<date>-<sha>.json (e2e/perf/reporter.ts) to be committed. The numbers mean nothing
// on another machine.
import { test } from '@playwright/test';
import {
  measureContinue,
  measureFirstFrameWarm,
  measureFrontDoor,
  measureRestart,
  measureSaveLoad,
} from './flows';
import { SLICE_URL } from '../helpers/slice';
import {
  browserName,
  describeLongTasks,
  enforce,
  frameMeasurements,
  instrument,
  playableMs,
  SAMPLE_FRAMES,
  sampleFrames,
  throttled,
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
  console.log(describeLongTasks('perf-baseline sampling', sample.longTasks));
  await enforce(testInfo, 'reference', {
    browser: browserName(page),
    frames: sample.run,
    measurements: [
      ...frameMeasurements(sample),
      // A real GPU renders a frame in milliseconds: any task ≥ 200 ms here is a hitch.
      { metric: 'longTasksOver200ms', value: sample.longTasks.over200, scene: 'perf-baseline' },
    ],
  });
});

// The wall-clock load budgets that used to be PR e2e assertions (mw-e41.8): same moments, measured
// in the page, enforced here against the reference machine. Budgets: perf/perf-budgets.json.
test.describe('load budgets', () => {
  test.setTimeout(240_000);

  test('slice: cold load to playable at 50 Mbps ≤ 10 s', async ({ page }, testInfo) => {
    await instrument(page);
    await throttled(page, true);
    await page.goto(SLICE_URL);
    const value = await playableMs(page, 60_000);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'loadToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('front door: New Game → Knight → Confirm playable ≤ 10 s of page load at 50 Mbps', async ({
    page,
  }, testInfo) => {
    const value = await measureFrontDoor(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'frontDoorLoadMs', value, scene: 'slice' }],
    });
  });

  test('front door: first frame on a warm reload ≤ 3 s', async ({ page }, testInfo) => {
    const value = await measureFirstFrameWarm(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'firstFrameMs', value, scene: 'front-door' }],
    });
  });

  test('testbed: death → Load last save playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureSaveLoad(page, '/?scene=testbed&debug=1', 'testbed');
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'saveLoadToPlayableMs', value, scene: 'testbed' }],
    });
  });

  test('slice: death → Load last save playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureSaveLoad(page, '/?scene=slice&debug=1', 'slice');
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'saveLoadToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('slice: title Continue playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureContinue(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'continueToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('slice: Restart area playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureRestart(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'restartToPlayableMs', value, scene: 'slice' }],
    });
  });
});
