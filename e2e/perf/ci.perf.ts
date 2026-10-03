// The perf budget suite's CI mode (mw-e32.1): `pnpm perf`, and the perf-budget job on GitHub's
// GPU-less runners. It enforces what does not need a GPU to mean something — transfer and bundle
// size, throttled load times, heap and long tasks that are not frame renders — and records
// software-rendered frame time (and the long tasks that are frame renders), which CI compares with
// main's as a warning only (scripts/perf/compare-cli.ts, AC-5). Budgets: perf/perf-budgets.json,
// every number from contract §1. Harness: ./harness.ts.
import { test } from '@playwright/test';
import {
  browserName,
  countBytes,
  directoryBytes,
  enforce,
  frameMeasurements,
  describeLongTasks,
  instrument,
  longTasksBetween,
  playableMs,
  sampleFrames,
  throttled,
} from './harness';

/** Idle time before the heap is read (AC-4: 5 minutes); PERF_HEAP_IDLE_S shortens local runs. */
const HEAP_IDLE_S = Number(process.env['PERF_HEAP_IDLE_S'] ?? '300');
/** Most seconds of frame sampling: software rendering on a 2-core runner can be slow. */
const FRAME_CAP_S = Number(process.env['PERF_FRAME_CAP_S'] ?? '150');

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test('AC-2: initial transfer, throttled load-to-playable and warm reload of the testbed', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const cdp = await throttled(page, true);
  const bytes = countBytes(cdp);
  await page.goto('/?scene=testbed');
  const cold = await playableMs(page, 60_000);
  // Everything the first visit fetches: until playable, then until the network goes quiet.
  await page.waitForLoadState('networkidle');
  const transfer = bytes.total();
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await page.reload();
  const warm = await playableMs(page, 60_000);
  await enforce(testInfo, 'ci', {
    browser: browserName(page),
    measurements: [
      { metric: 'initialTransferBytes', value: transfer, scene: 'testbed' },
      { metric: 'loadToPlayableMs', value: cold, scene: 'testbed' },
      { metric: 'warmReloadMs', value: warm, scene: 'testbed' },
    ],
  });
});

test('bundle size of the production build', async ({ page }, testInfo) => {
  await enforce(testInfo, 'ci', {
    browser: browserName(page),
    measurements: [{ metric: 'bundleBytes', value: directoryBytes('dist') }],
  });
});

test('perf-baseline: software-rendered frame time and long tasks that are not frame renders', async ({
  page,
}, testInfo) => {
  test.setTimeout((FRAME_CAP_S + 120) * 1_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const sample = await sampleFrames(page, {
    scene: 'perf-baseline',
    capS: FRAME_CAP_S,
    minSamples: 300,
    viewport: '1280×720 @1x',
  });
  console.log(
    `[perf] perf-baseline ${String(sample.run.frame.count)} frames on ${sample.run.renderer}: ` +
      `p50 ${sample.run.frame.p50.toFixed(2)} / p95 ${sample.run.frame.p95.toFixed(2)} ms`,
  );
  console.log(describeLongTasks('perf-baseline sampling', sample.longTasks));
  // Frame time has no absolute budget in CI mode (software rendering); it is recorded for the
  // comparison with main. Software-rendered frames are long tasks themselves, so all long tasks
  // are only reported; the ones that are not frame renders are enforced.
  await enforce(testInfo, 'ci', {
    browser: browserName(page),
    frames: sample.run,
    measurements: [
      ...frameMeasurements(sample),
      { metric: 'longTasksOver200ms', value: sample.longTasks.over200, scene: 'perf-baseline' },
      {
        metric: 'nonFrameLongTasksOver200ms',
        value: sample.longTasks.nonFrameOver200,
        scene: 'perf-baseline',
      },
    ],
  });
});

test('AC-4: JS heap and long tasks over 5 minutes idle in the testbed', async ({
  page,
}, testInfo) => {
  test.setTimeout((HEAP_IDLE_S + 120) * 1_000);
  await page.goto('/?scene=testbed');
  const playable = await playableMs(page, 60_000);
  const cdp = await page.context().newCDPSession(page);
  const before = (await cdp.send('Runtime.getHeapUsage')).totalSize;
  await page.waitForTimeout(HEAP_IDLE_S * 1_000);
  const after = await cdp.send('Runtime.getHeapUsage');
  // Long tasks while idling in play, from the first playable frame to now.
  const idle = await longTasksBetween(page, playable, await page.evaluate(() => performance.now()));
  console.log(describeLongTasks(`testbed idle ${String(HEAP_IDLE_S)} s`, idle));
  const load = await longTasksBetween(page, 0, playable);
  console.log(describeLongTasks('testbed load to playable (reported only)', load));
  console.log(
    `[perf] heap after ${String(HEAP_IDLE_S)} s idle: ${(after.totalSize / 1e6).toFixed(1)} MB allocated ` +
      `(${(after.usedSize / 1e6).toFixed(1)} MB used; ${(before / 1e6).toFixed(1)} MB at start)`,
  );
  await enforce(testInfo, 'ci', {
    measurements: [
      { metric: 'heapBytesAfterIdle', value: after.totalSize, scene: 'testbed' },
      { metric: 'nonFrameLongTasksOver200ms', value: idle.nonFrameOver200, scene: 'testbed' },
    ],
  });
});
