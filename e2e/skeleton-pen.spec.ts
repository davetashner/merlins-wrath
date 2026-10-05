import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock } from './helpers/player';

// mw-ju8.19: the skeleton pen (?scene=skeleton-pen) against the production build (Chromium): the whole
// Forgotten roster - miner, archer, shield-bearer and brute - is loaded and drawn at its post. The
// fights themselves are headless (tests/integration/forgotten-roster.test.ts).
//
// Built for a slow runner (CI draws about one frame a second and every Playwright round trip costs
// 2-3 s): one small test, a poll on data-creatures and no wall-clock timing.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

test('AC-3: the pen loads the whole Forgotten roster at its posts, standing', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=skeleton-pen&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'skeleton-pen', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  await expect
    .poll(async () => JSON.parse((await app.getAttribute('data-creatures')) ?? 'null') as unknown)
    .toMatchObject({
      kinds: {
        'forgotten-miner': 1,
        'forgotten-archer': 1,
        'forgotten-shield-bearer': 1,
        'forgotten-brute': 1,
      },
      drawn: 4,
    });
  expect(problems).toEqual([]);
});
