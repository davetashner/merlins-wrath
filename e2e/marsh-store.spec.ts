import { expect, test, type Page } from '@playwright/test';
import { holdKey, playerState, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-ju8.9: Marsh's General Store against the production build (Chromium). AC-1: from the street the
// player opens the front door and walks in; the interior is loaded and Ottilie Marsh stands behind
// the counter (#app[data-creatures] and #app[data-ai]). The counter prompts "Trade" and Interact on
// it completes (#app[data-interactions]); the shop screen itself is mw-e20.10. AC-3: up the 12-step
// stair to the second floor, where the bed and the table are (the console's `tp` knows the scene's
// named spawns). The scene is dev-only until area transitions (mw-e01.11): ?scene=marsh-store.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

const W = { code: 'KeyW', key: 'w' };

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

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

/** Opens the store with the debug console and waits for the player to stand in a running sim. */
async function openStore(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=marsh-store&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'marsh-store', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

/** Runs `line` in the debug console, leaving it closed again and the game under the player's hand. */
async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
}

test('AC-1: from the street, open the front door and walk in: the shopkeeper is behind the counter', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await openStore(page);
  await takeControl(page);

  // Ottilie is in the loaded interior, drawn, standing north of the counter (z 1…2) at her post.
  await expect
    .poll(() => data<{ kinds: Record<string, number>; drawn: number }>(page, 'creatures'))
    .toMatchObject({ kinds: { 'npc-ottilie': 1 }, drawn: 1 });
  const keeper = async () =>
    (await data<{ agents: { at: number[]; state: string }[] }>(page, 'ai'))?.agents[0];
  await expect.poll(async () => (await keeper())?.at[2]).toBeGreaterThan(2);
  // Noticing a customer is a glance, not an alarm: unaware, or suspicious ("noticed someone").
  expect((await keeper())?.state).toMatch(/^(unaware|suspicious)$/);

  // Out on the street, facing the closed front door: Interact opens it and the player walks in.
  await run(page, 'tp street-exit');
  await turnTo(page, { x: 0, z: -4 });
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Open');
  await page.keyboard.press('KeyE');
  const inside = await holdKey(page, W, 75, 10);
  expect(inside.position.z).toBeGreaterThan(-3.5);
  expect(inside.position.y).toBeLessThan(0.5);

  // She is still behind the counter, and the counter offers a trade.
  expect((await keeper())?.at[2]).toBeGreaterThan(2);
  await run(page, 'tp -2 0 -0.25');
  await turnTo(page, { x: -2, z: 1 });
  await expect(prompt).toContainText('Trade');
  await page.keyboard.press('KeyE');
  await expect
    .poll(() => data<{ verb: string; spawn: string | null }[]>(page, 'interactions'))
    .toContainEqual({ tick: expect.any(Number), verb: 'use', spawn: 'shop-counter' });
  expect(problems).toEqual([]);
});

test('AC-3: up the stair to the second floor, where the bed and the table are', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await openStore(page);
  await takeControl(page);

  // From the foot of the 12-step stair, straight up it: no jump, no stuck step.
  await run(page, 'tp 4 0 -3.5');
  await turnTo(page, { x: 4, z: 3 });
  const top = await holdKey(page, W, 150, 10);
  expect(top.position.y).toBeGreaterThan(2.9);
  expect(top.position.z).toBeGreaterThan(2.5);

  // The bed and the table are named places up here.
  for (const place of ['bed', 'table']) {
    await run(page, `tp ${place}`);
    await expect.poll(async () => (await playerState(page)).position.y).toBeGreaterThan(3);
  }
  expect(problems).toEqual([]);
});
