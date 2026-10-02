import { expect, test, type Page } from '@playwright/test';

// mw-e03.11 AC-6: the weak-wall room against the production build (Chromium). The knight starts
// facing a cracked old wall with no way round it. The bot uses the heavy-attack placeholder (the
// debug console's `act sword-heavy`, the real heavy swing through the action timeline) on the wall,
// then walks forward with W through the passage it opened into the back room. The page publishes
// what broke on #app[data-breakables] and the player on #app[data-player]; the test only reads them.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The dividing wall's far face, metres along z. */
const WALL_FAR_FACE = 2.1;

interface Breaks {
  broken: { profile: string; cause: string; by: string }[];
  passages: string[];
  debris: number;
}

interface PlayerData {
  position: { x: number; y: number; z: number };
  grounded: boolean;
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

/** Loads the room with the console, grants pointer lock as a browser does, and takes control. */
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
  await page.goto('/?scene=weak-wall-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'weak-wall-room', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-breakables', /"passages":\[\]/);
}

async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

test('AC-6: a heavy attack on the weak wall opens a passage and the bot walks through it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await play(page);
  // The wall blocks the way: walking into it gets nowhere.
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1_000);
  await page.keyboard.up('KeyW');
  expect((await data<PlayerData>(page, 'player')).position.z).toBeLessThan(WALL_FAR_FACE - 0.5);
  // The heavy attack placeholder.
  await run(page, 'act sword-heavy');
  await expect
    .poll(async () => (await data<Breaks>(page, 'breakables')).passages, { timeout: 10_000 })
    .toEqual(['weak-wall-passage']);
  const breaks = await data<Breaks>(page, 'breakables');
  expect(breaks.broken).toEqual([
    expect.objectContaining({ profile: 'old-wall', cause: 'structure', by: 'blunt' }),
  ]);
  // Walk on through into the back room.
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await data<PlayerData>(page, 'player')).position.z, { timeout: 20_000 })
    .toBeGreaterThan(WALL_FAR_FACE + 0.5);
  await page.keyboard.up('KeyW');
  expect(problems).toEqual([]);
});
