import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';

// mw-ju8.9: Marsh's General Store against the production build (Chromium). AC-1: from the street the
// player opens the front door and walks in; the interior is loaded and Ottilie Marsh stands behind
// the counter (#app[data-creatures] and #app[data-ai]). The counter prompts "Trade" and Interact on
// it opens the shop screen (#app[data-shop]) for marsh-general-store, and a purchase works (mw-e20.10). AC-3: up the 12-step
// stair to the second floor, where the bed and the table are (the console's `tp` knows the scene's
// named spawns). The scene is dev-only until area transitions (mw-e01.11): ?scene=marsh-store.
//
// Built for a slow runner (mw-ju8.18). CI draws about one frame a second in software GL, and there
// every Playwright round trip (a key press, an attribute read, an expect poll) costs 2-3 s: one long
// test of ~45 actions timed out at 90 s, twice. So each test proves one thing, starts near it with a
// teleport (`runConsole`: the whole console sequence in one page evaluation), and keeps its action
// count low; none waits on a locator's frame-paced actionability checks. Only the door test walks.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

const W = { code: 'KeyW', key: 'w' };

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

/** Ottilie's published state: where she stands and what she makes of the player. */
const keeper = async (page: Page) =>
  (await data<{ agents: { at: number[]; state: string }[] }>(page, 'ai'))?.agents[0];

test('AC-1: the interior is loaded and the shopkeeper stands behind the counter', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openStore(page);

  // Ottilie is in the loaded interior, drawn, standing north of the counter (z 1…2) at her post.
  await expect
    .poll(() => data<{ kinds: Record<string, number>; drawn: number }>(page, 'creatures'))
    .toMatchObject({ kinds: { 'npc-ottilie': 1 }, drawn: 1 });
  await expect.poll(async () => (await keeper(page))?.at[2]).toBeGreaterThan(2);
  // Noticing a customer is a glance, not an alarm: unaware, or suspicious ("noticed someone").
  expect((await keeper(page))?.state).toMatch(/^(unaware|suspicious)$/);
  expect(problems).toEqual([]);
});

test('AC-1: from the street, open the front door and walk in', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = collectProblems(page);
  await openStore(page);
  await takeControl(page);

  // Out on the street, facing the closed front door: Interact opens it and the player walks in.
  await runConsole(page, 'tp street-exit');
  await turnTo(page, { x: 0, z: -4 });
  await expect(page.getByTestId('interact-prompt')).toContainText('Open');
  await page.keyboard.press('KeyE');
  const inside = await holdKey(page, W, 75, 10);
  expect(inside.position.z).toBeGreaterThan(-3.5);
  expect(inside.position.y).toBeLessThan(0.5);
  // She is still behind the counter.
  expect((await keeper(page))?.at[2]).toBeGreaterThan(2);
  expect(problems).toEqual([]);
});

test('AC-1: the counter offers a trade, opens the shop for her merchant, and a purchase works', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await openStore(page);
  await takeControl(page);

  await runConsole(page, 'tp -2 0 -0.25');
  await turnTo(page, { x: -2, z: 1 });
  await expect(page.getByTestId('interact-prompt')).toContainText('Trade');
  await page.keyboard.press('KeyE');
  // The shop screen opens for her merchant (#app[data-shop]); the dev scene tops the player up to 400.
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
  expect(await data<{ merchant: string; crowns: number }>(page, 'shop')).toMatchObject({
    merchant: 'marsh-general-store',
    crowns: 400,
  });
  await expect(page.locator('[data-screen="shop"] .vb-shop-name')).toHaveText('Ottilie Marsh');
  // Buying works: lockpicks leave the shelf for the pack and cost crowns. Lockpicks sit below the
  // fold of the scrolling list, and Playwright's frame-paced click checks (visible, stable) never
  // settle at a frame a second: reach the row as a keyboard player does, focus it (the browser
  // scrolls it into view) and press Enter.
  await page.locator('[data-screen="shop"] [aria-label^="Buy Lockpicks"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('shop-status')).toHaveText(/^Bought Lockpicks for \d+ crowns\.$/);
  const after = await data<{ crowns: number; pack: { item: string; count: number }[] }>(
    page,
    'shop',
  );
  expect(after?.crowns).toBeLessThan(400);
  expect(after?.pack).toContainEqual({ item: 'lockpicks', count: 1 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":false/);
  expect(problems).toEqual([]);
});

test('AC-3: from the foot of the stair, straight up it to the second floor', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await openStore(page);
  await takeControl(page);

  // From the foot of the 12-step stair, straight up it: no jump, no stuck step.
  await runConsole(page, 'tp 4 0 -3.5');
  await turnTo(page, { x: 4, z: 3 });
  const top = await holdKey(page, W, 150, 10);
  expect(top.position.y).toBeGreaterThan(2.9);
  expect(top.position.z).toBeGreaterThan(2.5);
  expect(problems).toEqual([]);
});

test('AC-3: the bed and the table are named places on the second floor', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openStore(page);
  await takeControl(page);

  for (const place of ['bed', 'table']) {
    await runConsole(page, `tp ${place}`);
    await expect.poll(async () => (await playerState(page)).position.y).toBeGreaterThan(3);
  }
  expect(problems).toEqual([]);
});
