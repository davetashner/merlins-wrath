import { expect, test, type Page } from '@playwright/test';

// mw-e11.21 and mw-e11.23: creature AI running in the game loop, against the production build
// (Chromium), which is a debug build: with ?debug=1 the console loads and spawns fixture creatures.
// The page publishes #app[data-ai] after every sim step: each thinking creature's alert state, feet
// and whether it stands on the scene's navmesh, how many agent-ticks were seen off it, and
// perception's work units (last tick, peak, per-tick budget). With ?perf the HUD shows the same
// perception line (the perf overlay). Reads are one round trip each; CI draws a few frames a second
// and runs at most five sim ticks a frame, so waits are on sim state, never on wall time.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface AiReadout {
  agents: {
    entity: number;
    state: string;
    activity: string | null;
    at: [number, number, number];
    onMesh: boolean;
  }[];
  navmesh: boolean;
  offMesh: number;
  perception: { budget: number; peak: number; last: number };
}

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

async function aiReadout(page: Page): Promise<AiReadout | null> {
  return page.evaluate(() => {
    const json = document.querySelector<HTMLElement>('#app')?.dataset['ai'];
    return json === undefined ? null : (JSON.parse(json) as AiReadout);
  });
}

async function openConsole(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
    timeout: 30_000,
  });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
}

async function typeCommand(page: Page, line: string, echo: string): Promise<void> {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('debug-console-log')).toContainText(echo);
}

test('mw-e11.21 AC-2: a fixture guard patrols the testbed through the arena doorway on the navmesh, with no console errors', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await openConsole(page, '/?scene=testbed&debug=1');
  // The player waits in the room's east corner, out of the corridor's sight.
  await typeCommand(page, 'tp 4 0 2', 'teleporting to 4 0 2');
  await typeCommand(
    page,
    'spawn fixture-guard --patrol 0,0,12;0,0,20',
    'spawning 1 × fixture-guard --patrol 0,0,12;0,0,20',
  );
  await expect
    .poll(async () => (await aiReadout(page))?.agents.length, { timeout: 30_000 })
    .toBe(1);
  // It starts in the corridor (z 12) and walks its route into the arena (past the doorway at z 15).
  await expect
    .poll(async () => (await aiReadout(page))?.agents[0]?.at[2] ?? 0, { timeout: 150_000 })
    .toBeGreaterThan(16);
  const readout = await aiReadout(page);
  expect(readout).toMatchObject({ navmesh: true, offMesh: 0 });
  expect(readout?.agents[0]).toMatchObject({ state: 'unaware', onMesh: true });
  expect(problems).toEqual([]);
});

test('mw-e11.23 AC-2: guards spawned in the testbed perceive within perception’s budget, shown by the perf overlay, with no console errors', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openConsole(page, '/?scene=testbed&debug=1&perf');
  await typeCommand(page, 'god on', 'god mode on');
  await typeCommand(page, 'spawn fixture-guard 3', 'spawning 3 × fixture-guard');
  await expect
    .poll(async () => (await aiReadout(page))?.agents.length, { timeout: 30_000 })
    .toBe(3);
  // They face the lit player: perception spends work on them and they notice.
  await expect
    .poll(async () => (await aiReadout(page))?.agents.some((a) => a.state !== 'unaware'), {
      timeout: 60_000,
    })
    .toBe(true);
  const readout = await aiReadout(page);
  if (readout === null) throw new Error('no AI readout');
  const { peak, budget } = readout.perception;
  expect(peak).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(budget);
  const overlay = page.getByTestId('perf-overlay');
  await expect(overlay).toContainText(`/${String(budget)} units`);
  await expect(overlay).toContainText('3 thinking');
  expect(problems).toEqual([]);
});
