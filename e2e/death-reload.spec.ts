import { expect, test, type Page } from '@playwright/test';

// mw-e30.7: death → reload in the testbed, against the production build (Chromium). The debug
// console (?debug=1) makes a save with `save` (publishing the tick and sim state hash it saved on
// #app[data-saved-game]) and kills the player with `kill`; the death screen then offers the reload.
// Loading reloads the page into the save's area and loads the save before the first sim step;
// #app[data-loaded-save] carries the state hash right after the load.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Readout {
  slot: string;
  tick: number;
  hash: string;
  status?: string;
  requestedAt?: number | null;
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

async function readout(page: Page, attribute: string): Promise<Readout> {
  const json = await page.locator('#app').getAttribute(attribute);
  return JSON.parse(json ?? 'null') as Readout;
}

async function playerTick(page: Page): Promise<number> {
  const json = await page.locator('#app').getAttribute('data-player');
  return (JSON.parse(json ?? 'null') as { tick: number } | null)?.tick ?? -1;
}

/** Waits until the testbed's player stands in a running sim. */
async function ready(page: Page): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await type(page, line);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

/** Types `line` into the debug console, leaving it open (the death screen opens over it). */
async function type(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

test('AC-2: after a death, Load last save is playable within 3 s at the save’s state hash', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  // On every page: the wall-clock time the player first moves on from a loaded save (the first sim
  // step after it), seen by a MutationObserver as it happens, so test polling never adds to it.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const app = document.querySelector<HTMLElement>('#app');
      const loaded = app?.dataset['loadedSave'];
      const player = app?.dataset['player'];
      if (loaded === undefined || player === undefined) return;
      const { tick } = JSON.parse(loaded) as { tick: number };
      if ((JSON.parse(player) as { tick: number }).tick <= tick) return;
      (window as unknown as { playableAt: number }).playableAt = Date.now();
      observer.disconnect();
    });
    observer.observe(document, { attributes: true, subtree: true });
  });
  await page.goto('/?scene=testbed&debug=1');
  await ready(page);
  // Warm the cache the reload will use, as a second visit would be.
  await page.waitForLoadState('networkidle');

  // An autosave first, then a manual save: the manual one is the most recent (AC-1 in the unit).
  await run(page, 'save auto-1');
  await expect(page.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"auto-1"/);
  await run(page, 'save manual-1');
  await expect(page.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/);
  const saved = await readout(page, 'data-saved-game');

  await type(page, 'kill');
  const screen = page.locator('[data-screen="death"]');
  // The death beat (mw-e01.8, 90 sim ticks) runs first: seconds of wall time on a slow runner.
  await expect(screen).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-death', /"last":"manual-1"/);
  const load = screen.getByRole('button', { name: 'Load last save' });
  await expect(load).toBeFocused();
  await expect(screen.getByRole('button', { name: 'Load…' })).toBeVisible();

  await load.click();
  await ready(page);
  await expect(page.locator('#app')).toHaveAttribute('data-loaded-save', /"hash"/);
  const loaded = await readout(page, 'data-loaded-save');
  expect(loaded).toMatchObject({ slot: 'manual-1', status: 'loaded', tick: saved.tick });
  expect(loaded.hash).toBe(saved.hash);
  // Playable: no screen holds the sim, and it is stepping on from the save.
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  await expect.poll(() => playerTick(page)).toBeGreaterThan(loaded.tick);
  // From the click on Load last save (stamped in the hand-off) to the first step from the save.
  const playableAt = await page.evaluate(
    () => (window as unknown as { playableAt: number }).playableAt,
  );
  const elapsed = playableAt - (loaded.requestedAt ?? 0);
  test.info().annotations.push({ type: 'reload-ms', description: String(elapsed) });
  expect(elapsed).toBeGreaterThan(0);
  expect(elapsed).toBeLessThanOrEqual(3_000);
  expect(problems).toEqual([]);
});

test('AC-3: with no saves the death screen offers Restart area, which restarts without errors', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&debug=1');
  await ready(page);

  await type(page, 'kill');
  const screen = page.locator('[data-screen="death"]');
  // The death beat (mw-e01.8, 90 sim ticks) runs first: seconds of wall time on a slow runner.
  await expect(screen).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-death', /"saves":0/);
  await expect(screen.getByRole('button', { name: 'Load last save' })).toHaveCount(0);
  const restart = screen.getByRole('button', { name: 'Restart area' });
  await expect(restart).toBeFocused();

  const reloaded = page.waitForEvent('load');
  await restart.click();
  await reloaded;
  await ready(page);
  await expect(page.locator('[data-screen="death"]')).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('data-loaded-save', /./);
  await expect.poll(() => playerTick(page)).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
