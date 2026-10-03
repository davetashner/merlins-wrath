import { expect, test, type Page } from '@playwright/test';
import { holdKey, turnTo } from './helpers/player';

// mw-e03.18 AC-7: the grey-box mechanism room (laid out like the slice's spawn room) against the
// production build (Chromium). The knight starts facing the north doorway, shut by a portcullis, with
// the lever that raises it on the wall to the right. The bot pulls the lever with Interact (E), waits
// for the portcullis to rise, then walks north with W through the doorway into the corridor. The page
// publishes the doors and switches on #app[data-mechanisms] and the player on #app[data-player];
// the test only reads them.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The north wall's far face, metres along z: past it is the corridor. */
const WALL_FAR_FACE = 5.1;

interface Mechanisms {
  doors: Record<string, { status: string; openness: number }>;
  switches: Record<string, number>;
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
  await page.goto('/?scene=mechanism-room');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'mechanism-room', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-mechanisms', /"north-gate":\{"status":"closed"/);
}

test('AC-7: the bot pulls the lever, walks through the raised portcullis and reaches the corridor', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await play(page);
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  // The lever stands on the wall to the right of the doorway, in reach from the start.
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Pull lever', { timeout: 5_000 });
  await page.keyboard.press('KeyE');
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).switches['north-lever'])
    .toBe(1);
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).doors['north-gate'], {
      timeout: 10_000,
    })
    .toEqual({ status: 'open', openness: 1 });
  // Walk north through the doorway into the corridor.
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await data<PlayerData>(page, 'player')).position.z, { timeout: 20_000 })
    .toBeGreaterThan(WALL_FAR_FACE + 1.5);
  await page.keyboard.up('KeyW');
  expect(problems).toEqual([]);
});

// mw-e01.19 AC-3: a hinged door opens while the player leans on it. The west closet's wooden door is
// the slice's spawn-room door (same profile) and swings back, away from the hall, into the closet.
// The bot walks west until the door stops it, presses Interact without stepping back, and the door
// swings open past it instead of stopping blocked.
test('AC-3: the player walks into the wooden door, presses Interact and it opens without stepping back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await play(page);
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  // Across the hall to just short of the west doorway, then face west (yaw π/2 looks along −x).
  await turnTo(page, { x: -4, z: 0 });
  await holdKey(page, { code: 'KeyW', key: 'w' }, 40, 20);
  await turnTo(page, { x: -4, z: 0 }, { tolerance: 0.05 });
  await holdKey(page, { code: 'KeyW', key: 'w' }, 30, 20);
  await turnTo(page, Math.PI / 2);
  // Into the door until it stops the player, leaning on its front face (x = −4.97).
  const leaning = await holdKey(page, { code: 'KeyW', key: 'w' }, 90, 10);
  expect(leaning.position.x).toBeGreaterThan(-4.97);
  expect(leaning.position.x).toBeLessThan(-4.5);
  expect(Math.abs(leaning.position.z)).toBeLessThan(0.5);
  await expect(page.getByTestId('interact-prompt')).toContainText('Open door', { timeout: 5_000 });
  await page.keyboard.press('KeyE');
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).doors['west-door'], {
      timeout: 10_000,
    })
    .toEqual({ status: 'open', openness: 1 });
  // The player never had to step back.
  const after = (await data<PlayerData>(page, 'player')).position;
  expect(after.x).toBeLessThan(-4.5);
  expect(problems).toEqual([]);
});
