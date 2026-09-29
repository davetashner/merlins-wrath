import { expect, test } from '@playwright/test';

// mw-e29.1 AC-7: frame time with 50 simultaneous effects at the High particle cap, through the ?perf
// probe (see e2e/perf.spec.ts for the method). Opt-in, because the number only means something headed
// on the reference machine (MacBook Pro M1 Pro, Chrome, High):
//
//   VESPER_PERF=1 pnpm exec playwright test e2e/vfx-perf.spec.ts --headed
//
// `?vfx=stress` spawns 50 looping vfx-test-stress effects that together reserve the whole 2000-particle
// High cap. Budget: frame interval p95 ≤ 16.7 ms (60 fps). VESPER_PERF_SECONDS sets the sampling time
// (default 20 s); VESPER_PERF_CHANNEL=chrome uses installed Chrome.

const SECONDS = Number(process.env['VESPER_PERF_SECONDS'] ?? '20');
const BUDGET_MS = 16.7;

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

test('AC-7: 50 effects at the High cap keep frame time p95 ≤ 16.7 ms', async ({ page }) => {
  test.setTimeout((SECONDS + 30) * 1_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?scene=testbed&vfx=stress&perf=${String(SECONDS)}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-perf', /frame/, { timeout: (SECONDS + 20) * 1_000 });
  const stats = JSON.parse((await app.getAttribute('data-vfx')) ?? '{}') as {
    effects: number;
    reserved: number;
    cap: number;
  };
  expect(stats.effects).toBe(50);
  expect(stats.reserved).toBe(stats.cap);
  const report = JSON.parse((await app.getAttribute('data-perf')) ?? '{}') as Report;
  const summary = `frame p50/p95/p99 ${report.frame.p50.toFixed(2)}/${report.frame.p95.toFixed(2)}/${report.frame.p99.toFixed(2)} ms; work p50/p95/p99 ${report.work.p50.toFixed(2)}/${report.work.p95.toFixed(2)}/${report.work.p99.toFixed(2)} ms over ${String(report.frame.count)} frames`;
  console.log(`[perf] ${summary}`);
  test.info().annotations.push({ type: 'perf', description: summary });
  expect(report.frame.p95).toBeLessThanOrEqual(BUDGET_MS);
});
