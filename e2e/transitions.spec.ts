import { expect, test, type Page } from '@playwright/test';
import { playerState, runConsole, stubPointerLock } from './helpers/player';

// mw-e01.11: walking between areas against the production build (Chromium). The player teleports
// next to a gate (`runConsole`, one page evaluation) and crosses it; the page reloads into the target
// scene (#app[data-scene]), the player stands at the named arrival spawn (#app[data-player]) and what
// it carried is still there. Built for a slow runner (mw-ju8.18): few actions, teleports, and no
// wall-clock assertions; the transition time budget lives in the perf suite (e2e/perf/flows.ts).

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
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

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

test('AC-1: crossing valley-01’s north gate arrives in valley-02 at its named spawn, and the south gate returns', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=valley-01&debug=1');
  await ready(page, 'valley-01');
  // Two metres inside the north gate (x 4.5…7.5, z 51.5…53.5).
  await runConsole(page, 'tp 6 0 52.5');
  await ready(page, 'valley-02');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"valley-02".*"spawn":"arrive-from-valley-01"/,
  );
  // arrive-from-valley-01 is at x 0, z 4.
  const arrived = await playerState(page);
  expect(arrived.position.x).toBeCloseTo(0, 0);
  expect(arrived.position.z).toBeGreaterThan(3);
  expect(arrived.position.z).toBeLessThan(6);
  // The arrival autosaved (area-transition trigger).
  await expect(app).toHaveAttribute(
    'data-autosave',
    /"kind":"area-transition".*"type":"saved"|"type":"saved".*"kind":"area-transition"/,
    {
      timeout: 60_000,
    },
  );

  // Back through the south gate (z 0.25…1.75): valley-01, at the spawn by its north end.
  await runConsole(page, 'tp 0 0 1');
  await ready(page, 'valley-01');
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(45);
  expect(problems).toEqual([]);
});
