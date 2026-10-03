import { expect, test, type Page } from '@playwright/test';

// mw-e01.4: the vertical slice's grey-box level (?scene=slice) against the production build
// (Chromium). The required route is a straight line north along x = 0 (docs/design/vertical-slice.md
// §4): the bot opens the spawn-room door with Interact (E), walks the corridor through CP-1 and CP-2,
// crosses the arena between the pillars and walks into the locked iron exit door without the key.
// The page publishes the doors on #app[data-mechanisms], the checkpoints entered on
// #app[data-checkpoints], the world facts on #app[data-facts] and the player on #app[data-player];
// the test only reads them.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Mechanisms {
  doors: Record<string, { status: string; openness: number }>;
}

interface PlayerData {
  position: { x: number; y: number; z: number };
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

async function data<T>(page: Page, key: string): Promise<T> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T;
}

const z = async (page: Page): Promise<number> =>
  (await data<PlayerData>(page, 'player')).position.z;

/** Loads the slice, grants pointer lock as a browser does, and takes control. */
async function play(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const lock: { element: Element | null } = { element: null };
    const change = () => document.dispatchEvent(new Event('pointerlockchange'));
    Object.defineProperty(Document.prototype, 'pointerLockElement', {
      configurable: true,
      get: () => lock.element,
    });
    Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
      lock.element = this;
      change();
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function exitPointerLock() {
      lock.element = null;
      change();
    };
  });
  await page.goto('/?scene=slice');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-mechanisms', /"exit-door":\{"status":"locked"/);
  await expect(app).toHaveAttribute('data-facts', '{}');
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
}

/** Holds W until the player is past `target` along z. */
async function walkTo(page: Page, target: number, timeout = 20_000): Promise<void> {
  await page.keyboard.down('KeyW');
  // Poll often (the default backs off to 1 s, 5 m of walking) so the player stops close to target.
  await expect.poll(() => z(page), { timeout, intervals: [50] }).toBeGreaterThan(target);
  await page.keyboard.up('KeyW');
}

test('mw-e01.4 AC-3: walking the route into the exit without the key, it stays locked with a "Locked." prompt and the slice is not complete', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await play(page);
  // Spawn room: walk up to the wooden door until it stops the player, and open it. Pressed up
  // against it, the leaf is held by the player (blocked); stepping back lets it swing open.
  await walkTo(page, 4.4);
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Open', { timeout: 5_000 });
  await page.keyboard.press('KeyE');
  await page.keyboard.down('KeyS');
  await expect.poll(() => z(page), { timeout: 10_000, intervals: [50] }).toBeLessThan(3.5);
  await page.keyboard.up('KeyS');
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).doors['spawn-door'], {
      timeout: 10_000,
    })
    .toEqual({ status: 'open', openness: 1 });
  // The corridor: CP-1 just past the door, CP-2 at its end before the arena.
  await walkTo(page, 24);
  await expect
    .poll(async () => data<string[]>(page, 'checkpoints'), { timeout: 5_000 })
    .toEqual(['cp-1', 'cp-2']);
  // Across the arena and into the iron door: it holds, locked, with the lock's hint.
  await page.keyboard.down('KeyW');
  await expect(prompt).toContainText('Locked.', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1_000);
  expect(await z(page)).toBeLessThan(37);
  expect((await data<Mechanisms>(page, 'mechanisms')).doors['exit-door']).toEqual({
    status: 'locked',
    openness: 0,
  });
  await expect(prompt).toContainText('Locked.');
  // No slice complete: the fact was never written.
  expect(await data<Record<string, unknown>>(page, 'facts')).toEqual({});
  expect(problems).toEqual([]);
});
