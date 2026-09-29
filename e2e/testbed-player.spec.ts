import { expect, test, type Page } from '@playwright/test';

// mw-e02.23: a controllable player capsule in ?scene=testbed, against the production build
// (Chromium). The page publishes the player's sim state on #app[data-player] (JSON: tick, feet
// position, grounded, yaw) after every sim tick a frame shows; the tests only read it.
//
// Input counts only while the pointer is locked to the canvas, and headless Chromium refuses pointer
// lock, so an init script stands in for the browser's lock: requestPointerLock locks at once and
// fires pointerlockchange, exactly as a granted request does. Everything after that (key events,
// the ActionSampler, the sim) is the real game.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The testbed's back wall: z = −5, 0.2 m thick, so its face is at z = −4.9. */
const BACK_WALL_FACE_Z = -4.9;
/** The player's capsule radius (src/content/data/controller/player.json). */
const RADIUS = 0.35;

interface PlayerData {
  tick: number;
  position: { x: number; y: number; z: number };
  grounded: boolean;
  yaw: number;
}

/** Console errors/warnings and uncaught exceptions raised by our own code. */
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

async function player(page: Page): Promise<PlayerData> {
  const json = await page.locator('#app').getAttribute('data-player');
  return JSON.parse(json ?? 'null') as PlayerData;
}

/** Waits until the sim has run `ticks` more ticks. */
async function waitTicks(page: Page, ticks: number): Promise<PlayerData> {
  const from = (await player(page)).tick;
  await expect.poll(async () => (await player(page)).tick).toBeGreaterThanOrEqual(from + ticks);
  return player(page);
}

/** Loads the testbed, waits for the player to settle and takes control (click to lock). */
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

test('AC-1: holding W for 1 s moves the player capsule at least 4 m forward, with no console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  const before = await player(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1_000);
  await page.keyboard.up('KeyW');
  const after = await waitTicks(page, 15); // coast to a stop
  // The player starts facing +z (into the room, towards the doorway).
  expect(after.position.z - before.position.z).toBeGreaterThanOrEqual(4);
  expect(Math.abs(after.position.x - before.position.x)).toBeLessThan(0.05);
  expect(problems).toEqual([]);
});

test('AC-2: walking into the testbed wall stops the capsule in front of it', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  // Back towards the wall behind the start, 3.9 m away: 2 s is more than enough to reach it.
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(2_000);
  const pressing = await player(page);
  await page.keyboard.up('KeyS');
  const rest = await waitTicks(page, 10);
  for (const { position } of [pressing, rest]) {
    // Stopped by the wall: the capsule's back is at the wall face, not beyond it.
    expect(position.z).toBeGreaterThan(BACK_WALL_FACE_Z + RADIUS - 0.02);
    expect(position.z).toBeLessThan(BACK_WALL_FACE_Z + RADIUS + 0.05);
  }
  expect(problems).toEqual([]);
});

test('AC-3: Space leaves the ground and lands again within 1 s', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  // Sample data-player on every animation frame, in the page, so no frame of the jump is missed.
  const sampling = page.evaluate(
    () =>
      new Promise<{ ms: number; y: number; grounded: boolean }[]>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const samples: { ms: number; y: number; grounded: boolean }[] = [];
        const start = performance.now();
        const read = () => {
          const data = JSON.parse(app?.dataset['player'] ?? 'null') as {
            position: { y: number };
            grounded: boolean;
          };
          samples.push({
            ms: performance.now() - start,
            y: data.position.y,
            grounded: data.grounded,
          });
          if (performance.now() - start < 1_500) requestAnimationFrame(read);
          else resolve(samples);
        };
        requestAnimationFrame(read);
      }),
  );
  await page.keyboard.press('Space');
  const samples = await sampling; // times are from before the press
  const offset = samples.findIndex((s) => !s.grounded);
  expect(offset).toBeGreaterThanOrEqual(0); // left the ground
  const air = samples.slice(offset);
  expect(Math.max(...air.map((s) => s.y))).toBeGreaterThan(0.5);
  const landed = air.find((s) => s.grounded);
  expect(landed).toBeDefined();
  expect(landed?.ms ?? Infinity).toBeLessThanOrEqual(1_000);
  expect(problems).toEqual([]);
});

test('the debug camera (F2) takes WASD from the player, and hands it back', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  const app = page.locator('#app');
  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'on');
  // Flying releases pointer lock, so the player stays put while the camera moves.
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  const parked = await player(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  expect((await waitTicks(page, 5)).position).toEqual(parked.position);
  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'off');
  await page.getByTestId('game-canvas').click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  expect((await waitTicks(page, 5)).position.z).toBeGreaterThan(parked.position.z + 0.5);
  expect(problems).toEqual([]);
});
