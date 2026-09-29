import { expect, test } from '@playwright/test';

// mw-e00.23 AC-8: UI update cost of a HUD with health, stamina and 4 quick slots, all changing every
// tick, measured in the gallery page (?hudbench=N: the vitals HUD's update() is timed every frame for
// N seconds). Budget: p95 ≤ 0.5 ms per frame.
//
// A short run (5 s) is part of every e2e pass. The bead's 30 s profile on the reference machine
// (MacBook Pro M1 Pro, Chrome, High) is opt-in, as for e2e/perf.spec.ts:
//
//   VESPER_PERF=1 pnpm exec playwright test e2e/ui-perf.spec.ts --headed
//
// VESPER_PERF_SECONDS overrides the duration; VESPER_PERF_CHANNEL=chrome uses installed Chrome.

const FULL = process.env['VESPER_PERF'] === '1';
const SECONDS = Number(process.env['VESPER_PERF_SECONDS'] ?? (FULL ? '30' : '5'));
const BUDGET_MS = 0.5;

interface Report {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

test.use({
  ...(process.env['VESPER_PERF_CHANNEL'] ? { channel: process.env['VESPER_PERF_CHANNEL'] } : {}),
});

test(`AC-8: vitals HUD update p95 ≤ ${String(BUDGET_MS)} ms per frame over ${String(SECONDS)} s`, async ({
  page,
}) => {
  test.setTimeout((SECONDS + 30) * 1_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/testbed/ui.html?hudbench=${String(SECONDS)}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-hud-bench', /p95/, { timeout: (SECONDS + 20) * 1_000 });
  const report = JSON.parse((await app.getAttribute('data-hud-bench')) ?? '{}') as Report;
  const summary = `HUD update p50/p95/max ${report.p50.toFixed(3)}/${report.p95.toFixed(3)}/${report.max.toFixed(3)} ms over ${String(report.count)} frames`;
  console.log(`[perf] ${summary}`);
  test.info().annotations.push({ type: 'perf', description: summary });
  expect(report.count).toBeGreaterThan(SECONDS * 20);
  expect(report.p95).toBeLessThanOrEqual(BUDGET_MS);
});
