import { expect, test, type Page } from '@playwright/test';
import { attachFrame, captureFrame, distinct } from './helpers/canvas';

// mw-e29.1 AC-6: the VFX framework in the greybox testbed, against the production build (Chromium).
// `?vfx=demo` spawns 20 test effects on a ring around the player start and shows the stats overlay;
// the page publishes the runtime's stats on #app[data-vfx] (JSON, see VfxStats in src/game/vfx).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface VfxStats {
  effects: number;
  dormant: number;
  particles: number;
  reserved: number;
  cap: number;
  refused: number;
  missing: number;
}

/** Console errors/warnings and uncaught exceptions raised by our own code. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function vfxStats(page: Page): Promise<VfxStats | null> {
  const json = await page.locator('#app').getAttribute('data-vfx');
  return JSON.parse(json ?? 'null') as VfxStats | null;
}

// Software WebGL renders every pixel on the CPU, so a small viewport keeps frames fast under load.
test.use({ viewport: { width: 640, height: 360 } });

test('AC-6: 20 test effects render in the greybox testbed with no console errors and a sane screenshot', async ({
  page,
}, testInfo) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&vfx=demo');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed');
  await expect(page.getByTestId('vfx-stats')).toContainText('VFX high');

  // All 20 effects run (the sparks repeat each second, so between repeats 15 may be live).
  await expect.poll(async () => (await vfxStats(page))?.particles ?? 0).toBeGreaterThan(50);
  const stats = await vfxStats(page);
  expect(stats).toMatchObject({ refused: 0, missing: 0, dormant: 0 });
  expect(stats?.effects).toBeGreaterThanOrEqual(15);
  expect(stats?.reserved).toBeLessThanOrEqual(stats?.cap ?? 0);

  // Capture the canvas alone and keep the frame as the screenshot artifact.
  const first = await captureFrame(page, { png: true });
  await attachFrame(testInfo, 'vfx-demo', first);
  expect(distinct(first)).toBeGreaterThan(8); // not blank

  // The scene and the idle player are still, so frames differ only where particles move.
  const later = await captureFrame(page, { afterMs: 400 });
  const changed = first.rgb.filter((colour, i) => colour !== later.rgb[i]).length;
  expect(changed).toBeGreaterThan(10);

  expect(problems).toEqual([]);
});
