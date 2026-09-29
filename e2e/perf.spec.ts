import { expect, test } from '@playwright/test';

// mw-e00.21 AC-6: frame time of the testbed scene through the ?perf probe. Opt-in, because the
// number only means something headed on the reference machine (MacBook Pro M1 Pro, Chrome, High):
//
//   VESPER_PERF=1 pnpm exec playwright test e2e/perf.spec.ts --headed
//
// The browser runs uncapped (vsync and the frame-rate limit off, as in the ADR-0001 benchmark), so
// the frame interval is real CPU + GPU throughput rather than the display refresh (8.33 ms at 120 Hz
// would fail an 8 ms budget by itself). Budget: frame interval p95 ≤ 8 ms; the main-thread work per
// frame is logged alongside. VESPER_PERF_SECONDS sets the sampling time (default 20 s). The viewport is
// 1280×720 at DPR 2, a 2560×1440 drawing buffer (High, 1440p-equivalent); VESPER_PERF_CHANNEL=chrome uses installed Chrome, the
// contract's reference browser, instead of Playwright's bundled Chromium.

const SECONDS = Number(process.env['VESPER_PERF_SECONDS'] ?? '20');
const BUDGET_MS = 8;

interface Report {
  frame: { count: number; p50: number; p95: number; p99: number };
  work: { count: number; p50: number; p95: number; p99: number };
}

test.skip(process.env['VESPER_PERF'] !== '1', 'set VESPER_PERF=1 (and run headed) to measure');
test.use({
  ...(process.env['VESPER_PERF_CHANNEL'] ? { channel: process.env['VESPER_PERF_CHANNEL'] } : {}),
  deviceScaleFactor: 2,
  launchOptions: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
});

test('AC-6: testbed frame time p95 ≤ 8 ms', async ({ page }) => {
  test.setTimeout((SECONDS + 30) * 1_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?scene=testbed&perf=${String(SECONDS)}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-perf', /frame/, { timeout: (SECONDS + 20) * 1_000 });
  const report = JSON.parse((await app.getAttribute('data-perf')) ?? '{}') as Report;
  const summary = `frame p50/p95/p99 ${report.frame.p50.toFixed(2)}/${report.frame.p95.toFixed(2)}/${report.frame.p99.toFixed(2)} ms; work p50/p95/p99 ${report.work.p50.toFixed(2)}/${report.work.p95.toFixed(2)}/${report.work.p99.toFixed(2)} ms over ${String(report.frame.count)} frames`;
  console.log(`[perf] ${summary}`);
  test.info().annotations.push({ type: 'perf', description: summary });
  expect(report.frame.p95).toBeLessThanOrEqual(BUDGET_MS);
});
