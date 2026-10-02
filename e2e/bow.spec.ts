import { expect, test, type Page } from '@playwright/test';

// mw-e05.21 AC-3: the bow in ?scene=testbed against the production build (Chromium). The player
// turns to the wooden target board on the room's back wall, takes the bow out (4), draws with the
// left button and lets go; the arrow must come to rest stuck in the board, drawn and on screen, with
// no console errors. The page publishes the player (with its bow) on #app[data-player], the camera's
// field of view on #app[data-orbit-camera] and, once an arrow exists, the arrows on #app[data-arrows];
// the test only reads them. Input goes through the game's own listeners while the pointer is locked
// (headless Chromium refuses pointer lock, so an init script grants it as a browser does).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The middle of the target board's face (src/content/data/scene/testbed.json), metres. */
const BOARD = { x: 1.5, z: -4.6 };
/** Mouse look, radians per count (the player camera's mouseSensitivity). */
const SENSITIVITY = 0.003;
/** The bow's nock sits this far right of the player's feet (DEFAULT_BOW_NOCK.right). */
const NOCK_RIGHT = 0.5;

interface PlayerData {
  position: { x: number; y: number; z: number };
  yaw: number;
  bow?: { equipped: boolean; draw: number | null; quiver: Record<string, number> };
}

interface ArrowData {
  stuck: number;
  latest: {
    state: string;
    position: { x: number; y: number; z: number };
    in: number | null;
    drawn: boolean;
    onScreen: boolean;
  } | null;
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

async function data<T>(page: Page, name: string): Promise<T> {
  const json = await page.locator('#app').getAttribute(`data-${name}`);
  return JSON.parse(json ?? 'null') as T;
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

const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** The look yaw that sends a shot from the nock at `feet` toward the board (yaw 0 looks along −z). */
function yawToBoard(feet: { x: number; z: number }): number {
  let yaw = Math.atan2(-(BOARD.x - feet.x), -(BOARD.z - feet.z));
  for (let i = 0; i < 3; i++) {
    const nock = { x: feet.x + Math.cos(yaw) * NOCK_RIGHT, z: feet.z - Math.sin(yaw) * NOCK_RIGHT };
    yaw = Math.atan2(-(BOARD.x - nock.x), -(BOARD.z - nock.z));
  }
  return yaw;
}

test('AC-3: the bow out, an arrow loosed at the back wall renders stuck in its target board, with no console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  const start = await data<PlayerData>(page, 'player');
  expect(start.bow).toMatchObject({ equipped: false, draw: null });
  // Turn to face the board: moving the mouse right turns right (yaw falls).
  const yaw = yawToBoard(start.position);
  const counts = Math.round(-wrap(yaw - start.yaw) / SENSITIVITY);
  await page.evaluate((movementX) => {
    window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY: 0 }));
  }, counts);
  await expect
    .poll(async () => Math.abs(wrap((await data<PlayerData>(page, 'player')).yaw - yaw)))
    .toBeLessThan(0.01);
  // 4 takes the bow out.
  await page.keyboard.press('Digit4');
  await expect.poll(async () => (await data<PlayerData>(page, 'player')).bow?.equipped).toBe(true);
  // Hold the left button to full draw: the camera narrows toward the bow's aim.
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  });
  await expect
    .poll(async () => (await data<PlayerData>(page, 'player')).bow?.draw ?? 0, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(48);
  await expect
    .poll(async () => (await data<{ fov: number }>(page, 'orbit-camera')).fov)
    .toBeLessThan(60);
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  });
  // The arrow flies and comes to rest stuck in the board, its shaft drawn and in view.
  await expect
    .poll(async () => (await data<ArrowData | null>(page, 'arrows'))?.latest?.state, {
      timeout: 5_000,
    })
    .toBe('stuck');
  const arrows = await data<ArrowData>(page, 'arrows');
  expect(arrows.stuck).toBe(1);
  expect(arrows.latest).toMatchObject({ drawn: true, onScreen: true });
  expect(arrows.latest?.in).not.toBeNull();
  expect(arrows.latest?.position.z).toBeGreaterThan(BOARD.z - 0.05);
  expect(arrows.latest?.position.z).toBeLessThan(BOARD.z + 0.05);
  expect(Math.abs((arrows.latest?.position.x ?? 0) - BOARD.x)).toBeLessThan(0.75);
  expect((await data<PlayerData>(page, 'player')).bow?.quiver['standard']).toBe(19);
  // The camera widens back once the shot is gone.
  await expect.poll(async () => (await data<{ fov: number }>(page, 'orbit-camera')).fov).toBe(70);
  await page.screenshot({ path: test.info().outputPath('bow-stuck.png') });
  expect(problems).toEqual([]);
});
