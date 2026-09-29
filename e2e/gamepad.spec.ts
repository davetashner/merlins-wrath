import { expect, test, type Page } from '@playwright/test';

// mw-e02.9: a virtual Xbox controller plays ?scene=testbed in the production build (Chromium). An
// init script replaces navigator.getGamepads with one standard-mapping pad whose buttons and axes the
// test sets through window.__pad; everything from there (the per-tick poll, the ActionSampler, the
// sim, the orbit camera, the controls hint) is the real game. No click and no pointer lock: the pad
// plays as soon as the page has focus.
//
// As in testbed-player.spec.ts, timing is in sim ticks read from #app[data-player], driven from
// inside the page on animation frames, so a slow software-rendered runner does the same thing.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface PlayerData {
  tick: number;
  position: { x: number; y: number; z: number };
  grounded: boolean;
  yaw: number;
  pitch: number;
}

/** What the page script sees on window.__pad. */
interface VirtualPad {
  /** Standard-mapping button values (0–1), index 0 = A. */
  buttons: number[];
  /** Left x, left y (down +), right x, right y (down +). */
  axes: number[];
  connected: boolean;
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

async function player(page: Page): Promise<PlayerData> {
  const json = await page.locator('#app').getAttribute('data-player');
  return JSON.parse(json ?? 'null') as PlayerData;
}

async function waitTicks(page: Page, ticks: number): Promise<PlayerData> {
  const from = (await player(page)).tick;
  await expect.poll(async () => (await player(page)).tick).toBeGreaterThanOrEqual(from + ticks);
  return player(page);
}

/** Loads the testbed with a virtual Xbox pad plugged in, and waits for the player to settle. */
async function playWithPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad: VirtualPad = {
      buttons: Array(17).fill(0) as number[],
      axes: [0, 0, 0, 0],
      connected: true,
    };
    (window as unknown as { __pad: VirtualPad }).__pad = pad;
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () =>
        pad.connected
          ? [
              {
                id: 'Virtual Xbox Controller (STANDARD GAMEPAD)',
                index: 0,
                connected: true,
                mapping: 'standard',
                timestamp: performance.now(),
                axes: [...pad.axes],
                buttons: pad.buttons.map((value) => ({
                  pressed: value > 0.5,
                  touched: value > 0,
                  value,
                })),
              },
            ]
          : [],
    });
    // Headless Chromium refuses pointer lock; stand in for a granted request, as
    // testbed-player.spec.ts does, so the AC-5 test can switch back to the keyboard.
    const lock: { element: Element | null } = { element: null };
    Object.defineProperty(Document.prototype, 'pointerLockElement', {
      configurable: true,
      get: () => lock.element,
    });
    Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
      lock.element = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    };
  });
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-gamepad', 'connected');
}

/**
 * Sets the pad, holds it for `ticks` sim ticks (counted from the published tick on animation frames)
 * and then lets go of everything. Returns how many ticks it was held.
 */
async function holdPad(
  page: Page,
  pad: { buttons?: Record<number, number>; axes?: number[] },
  ticks: number,
): Promise<number> {
  return page.evaluate(
    ({ pad, ticks }) =>
      new Promise<number>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const tick = () =>
          (JSON.parse(app?.dataset['player'] ?? '{"tick":0}') as { tick: number }).tick;
        const state = (window as unknown as { __pad: VirtualPad }).__pad;
        const from = tick();
        for (const [i, value] of Object.entries(pad.buttons ?? {}))
          state.buttons[Number(i)] = value;
        if (pad.axes) state.axes = [...pad.axes];
        const watch = () => {
          const held = tick() - from;
          if (held >= ticks) {
            state.buttons = state.buttons.map(() => 0);
            state.axes = [0, 0, 0, 0];
            resolve(held);
          } else {
            requestAnimationFrame(watch);
          }
        };
        requestAnimationFrame(watch);
      }),
    { pad, ticks },
  );
}

test('left stick forward for 60 ticks moves the player at least 4 m, with no click and no pointer lock', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await playWithPad(page);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  const before = await player(page);
  const held = await holdPad(page, { axes: [0, -1, 0, 0] }, 60);
  expect(held).toBeGreaterThanOrEqual(60);
  expect(held).toBeLessThanOrEqual(66);
  const after = await waitTicks(page, 15);
  expect(after.position.z - before.position.z).toBeGreaterThanOrEqual(4);
  expect(Math.abs(after.position.x - before.position.x)).toBeLessThan(0.05);
  expect(problems).toEqual([]);
});

test('the right stick turns the camera, and A jumps', async ({ page }) => {
  const problems = collectProblems(page);
  await playWithPad(page);
  const before = await player(page);
  await holdPad(page, { axes: [0, 0, 1, 0] }, 20);
  const turned = await waitTicks(page, 2);
  // Right is a turn to the right: yaw goes down (240°/s at full deflection, 1/3 s ≈ 1.4 rad).
  expect(turned.yaw).toBeLessThan(before.yaw - 0.8);
  expect(turned.position).toEqual(before.position);
  // A: leave the ground, sampled on every frame so no frame of the jump is missed.
  const samples = await page.evaluate(
    () =>
      new Promise<{ y: number; grounded: boolean }[]>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () =>
          JSON.parse(app?.dataset['player'] ?? 'null') as {
            tick: number;
            position: { y: number };
            grounded: boolean;
          };
        const pad = (window as unknown as { __pad: VirtualPad }).__pad;
        const from = read().tick;
        pad.buttons[0] = 1;
        const out: { y: number; grounded: boolean }[] = [];
        const sample = () => {
          const data = read();
          if (data.tick - from >= 3) pad.buttons[0] = 0;
          out.push({ y: data.position.y, grounded: data.grounded });
          if (data.tick - from < 45) requestAnimationFrame(sample);
          else resolve(out);
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(samples.some((s) => !s.grounded)).toBe(true);
  expect(Math.max(...samples.map((s) => s.y))).toBeGreaterThan(0.5);
  expect(problems).toEqual([]);
});

test('AC-5: the controls hint switches to Xbox glyphs after pad input, and back after a key', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await playWithPad(page);
  const hint = page.getByTestId('player-controls-hint');
  await expect(hint).toHaveText(/^Click to play: WASD move/);
  await holdPad(page, { buttons: { 2: 1 } }, 2); // X
  await expect(page.locator('#app')).toHaveAttribute('data-input-device', 'gamepad');
  await expect(hint).toHaveText(/^Controller: Left stick move, right stick look, A jump/);
  await page.getByTestId('game-canvas').click();
  await page.keyboard.press('KeyE');
  await expect(hint).toHaveText(/^Click to play: WASD move/);
  expect(problems).toEqual([]);
});
