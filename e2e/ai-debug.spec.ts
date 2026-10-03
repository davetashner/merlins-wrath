import { expect, test, type Page } from '@playwright/test';

// mw-e11.17: the AI debug overlay in the grey-box testbed, against the production build (Chromium),
// which is a debug build: with ?debug=1 the console (and the overlay with it) loads. The page
// publishes #app[data-ai-debug] after every frame: on/off, frozen, the selection, the snapshot's
// tick and how many agents, cones, labels and noise rings the overlay drew.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface AiDebugReadout {
  on: boolean;
  frozen: boolean;
  selected: number | null;
  tick: number | null;
  agents: number;
  cones: number;
  labels: number;
  noises: number;
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

/** The overlay readout and the creature count, in one round trip. */
async function readouts(page: Page): Promise<{ ai: AiDebugReadout | null; creatures: number }> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app');
    const ai = app?.dataset['aiDebug'];
    const creatures = app?.dataset['creatures'];
    return {
      ai: ai === undefined ? null : (JSON.parse(ai) as AiDebugReadout),
      creatures: creatures === undefined ? 0 : (JSON.parse(creatures) as { count: number }).count,
    };
  });
}

async function typeCommand(page: Page, line: string): Promise<void> {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

test('AC-2: three guards in the testbed, `ai.debug on`: overlay cones and labels for all 3, no console errors', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 15_000 });
  await expect.poll(async () => (await readouts(page)).ai?.on, { timeout: 10_000 }).toBe(false);
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await typeCommand(page, 'spawn fixture-guard 3');
  await expect.poll(async () => (await readouts(page)).creatures, { timeout: 15_000 }).toBe(3);
  await typeCommand(page, 'ai.debug on');
  await expect(page.getByTestId('debug-console-log')).toContainText('ai.debug on');
  await expect
    .poll(async () => (await readouts(page)).ai, { timeout: 15_000 })
    .toMatchObject({ on: true, agents: 3, cones: 3, labels: 3 });
  await expect(page.locator('[data-testid="ai-debug-label"]:visible')).toHaveCount(3);
  await expect(page.locator('[data-testid="ai-debug-label"]').first()).toContainText(
    'fixture-guard',
  );
  await expect(page.getByTestId('ai-debug-status')).toContainText('3 agents');

  // ai.freeze holds the sim; ai.step advances it one tick (AC-3 is the integration test).
  await typeCommand(page, 'ai.freeze on');
  await expect.poll(async () => (await readouts(page)).ai?.frozen).toBe(true);
  const frozenAt = (await readouts(page)).ai?.tick ?? -1;
  await page.waitForTimeout(500);
  expect((await readouts(page)).ai?.tick).toBe(frozenAt);
  await typeCommand(page, 'ai.step');
  await expect.poll(async () => (await readouts(page)).ai?.tick).toBe(frozenAt + 1);
  await typeCommand(page, 'ai.freeze off');
  await expect.poll(async () => (await readouts(page)).ai?.frozen).toBe(false);

  await typeCommand(page, 'ai.debug off');
  await expect
    .poll(async () => (await readouts(page)).ai)
    .toMatchObject({ on: false, agents: 0, labels: 0 });
  await expect(page.locator('[data-testid="ai-debug-label"]:visible')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('without the debug console the overlay never loads', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
  expect(await app.getAttribute('data-ai-debug')).toBeNull();
  await expect(page.getByTestId('ai-debug-layer')).toHaveCount(0);
});
