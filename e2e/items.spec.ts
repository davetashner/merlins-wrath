import { expect, test, type Page } from '@playwright/test';

// mw-e17.7: world items in ?scene=testbed, against the production build (Chromium). A healing
// draught lies on the floor to the player's left; the page publishes the player's pack, the world
// items and counts of takes and drops on #app[data-items] after every change. Pointer lock is
// stubbed as in e2e/testbed-player.spec.ts (headless Chromium refuses it); everything after that is
// the real game: mouse look, the Interact prompt, E to take and G to drop.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Stack {
  item: string;
  count: number;
  flags: Record<string, unknown>;
}

interface ItemsData {
  pack: Stack[];
  world: Stack[];
  taken: number;
  dropped: number;
  thrown: number;
  refused: string[];
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

async function items(page: Page): Promise<ItemsData | null> {
  const json = await page.locator('#app').getAttribute('data-items');
  return JSON.parse(json ?? 'null') as ItemsData | null;
}

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
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
}

/** Turns the player with small mouse moves until the prompt offers to take the draught. */
async function turnToDraught(page: Page): Promise<void> {
  const prompt = page.getByTestId('interact-prompt');
  for (let i = 0; i < 200; i++) {
    if (
      (await prompt.isVisible()) &&
      (await prompt.textContent())?.includes('Take Healing draught')
    ) {
      return;
    }
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: -25, movementY: 0 }));
    });
    await page.waitForTimeout(30);
  }
  throw new Error('never faced the draught');
}

test('mw-e17.7 AC-5: take, drop and take the draught again: one in the pack, none left lying', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  await expect
    .poll(() => items(page))
    .toEqual({
      pack: [],
      world: [{ item: 'healing-draught', count: 1, flags: {} }],
      taken: 0,
      dropped: 0,
      thrown: 0,
      refused: [],
    });

  await turnToDraught(page);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await items(page))?.taken).toBe(1);
  const afterTake = await items(page);
  expect(afterTake?.pack).toEqual([{ item: 'healing-draught', count: 1, flags: {} }]);
  expect(afterTake?.world).toEqual([]);

  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await items(page))?.dropped).toBe(1);
  const afterDrop = await items(page);
  expect(afterDrop?.pack).toEqual([]);
  expect(afterDrop?.world).toEqual([{ item: 'healing-draught', count: 1, flags: {} }]);

  // It fell in front of the player, so the prompt offers it again.
  await expect(page.getByTestId('interact-prompt')).toContainText('Take Healing draught');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await items(page))?.taken).toBe(2);
  const end = await items(page);
  expect(end?.pack).toEqual(afterTake?.pack);
  expect(end?.world).toEqual([]);
  expect(end?.refused).toEqual([]);
  expect(problems).toEqual([]);
});
