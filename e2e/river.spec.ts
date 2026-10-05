import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock } from './helpers/player';

// mw-e02.14: the River Wend against the production build (Chromium). The player teleports into
// valley-03's river off the Miners' Bridge (`runConsole`, one page evaluation), sinks in it (the
// starting knight's mail and shield are a Medium load, and Medium sinks), and teleports to the bank, where the readout
// says it is out of the water. Built for a slow runner (mw-ju8.18): two teleports and polls on the
// published sim state, no wall-clock assertions. The rules are unit-tested (src/sim/character/
// water.test.ts) and walked headless on the real scene data (tests/integration/river-swim.test.ts).

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

interface Readout {
  traversal: string | null;
  grounded: boolean;
  position: { x: number; y: number; z: number };
  water?: { inWater: boolean; sinking: boolean; breath: number };
}

async function readout(page: Page): Promise<Readout> {
  const json = await page.locator('#app').getAttribute('data-player');
  return JSON.parse(json ?? 'null') as Readout;
}

test('AC-1/AC-2: falling off the Miners’ Bridge puts the knight in the river, sinking; the bank is dry', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=valley-03&class=knight&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  expect((await readout(page)).water).toMatchObject({ inWater: false, breath: 1 });

  // Over the rail, 4 m above the water (the river's surface is at y = -2).
  await runConsole(page, 'tp 5 2 38');
  await expect.poll(async () => (await readout(page)).traversal, { timeout: 60_000 }).toBe('swim');
  const swimming = await readout(page);
  expect(swimming.water?.inWater).toBe(true);
  expect(swimming.water?.sinking).toBe(true);
  expect(swimming.position.y).toBeLessThan(-3);

  // On the near bank, out of the water.
  await runConsole(page, 'tp 6.5 0 28.5');
  await expect
    .poll(async () => (await readout(page)).water?.inWater, { timeout: 60_000 })
    .toBe(false);
  const dry = await readout(page);
  expect(dry.traversal).toBeNull();
  expect(problems).toEqual([]);
});
