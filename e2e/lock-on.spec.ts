import { expect, test, type Page } from '@playwright/test';

// mw-e02.16 AC-6: lock-on in the greybox testbed's arena, against the production build (Chromium).
// The bot walks the player through the corridor into the arena doorway, locks on with Q and cycles
// with Tab; the HUD lock marker ([data-testid=lock-marker], data-target = the locked entity) must
// visit all three training dummies at three different places on screen, with no console errors.
//
// As in testbed-player.spec.ts, an init script stands in for pointer lock (headless Chromium refuses
// it), and keys are real DOM key events through the game's own listeners.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface PlayerData {
  tick: number;
  position: { x: number; y: number; z: number };
  lock?: number | null;
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

/** Waits until the sim has run `ticks` more ticks (sim time, not wall time: CI renders slowly). */
async function waitTicks(page: Page, ticks: number): Promise<void> {
  const from = (await player(page)).tick;
  await expect
    .poll(async () => (await player(page)).tick, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(from + ticks);
}

/** Sprints (W + Shift) until the player is past `z` (sim state, so a slow runner only takes longer). */
async function walkTo(page: Page, z: number): Promise<void> {
  await page.evaluate(
    (target) =>
      new Promise<void>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const at = () =>
          (JSON.parse(app?.dataset['player'] ?? 'null') as { position: { z: number } }).position.z;
        const key = (type: string) => {
          window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w' }));
          window.dispatchEvent(new KeyboardEvent(type, { code: 'ShiftLeft', key: 'Shift' }));
        };
        key('keydown');
        const watch = () => {
          if (at() >= target) {
            key('keyup');
            resolve();
          } else {
            requestAnimationFrame(watch);
          }
        };
        requestAnimationFrame(watch);
      }),
    z,
  );
}

/** Taps a key: down, then up on the next animation frame. */
async function tap(page: Page, code: string, key: string): Promise<void> {
  await page.evaluate(
    ([c, k]) =>
      new Promise<void>((resolve) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: k }));
        requestAnimationFrame(() => {
          window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: k }));
          resolve();
        });
      }),
    [code, key] as const,
  );
}

interface MarkerSample {
  target: string;
  x: number;
  y: number;
  /** Where the marker is once the camera has settled on the target. */
  settled?: { x: number; y: number };
}

/**
 * Taps `code`, then reads the marker on the first drawn frame that shows a target other than
 * `previous`: the camera is then still (almost) framed on the previous target, since it takes a moment
 * to swing round. Then lets the camera settle on the new one.
 */
async function tapAndMark(
  page: Page,
  code: string,
  key: string,
  previous: string | undefined,
): Promise<MarkerSample> {
  const sample = await page.evaluate(
    ([c, k, before]) =>
      new Promise<MarkerSample>((resolve) => {
        const marker = document.querySelector<HTMLElement>('[data-testid="lock-marker"]');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: k }));
        let frames = 0;
        const watch = () => {
          frames += 1;
          if (frames === 1) window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: k }));
          const target = marker?.dataset['target'];
          if (marker !== null && !marker.hidden && target !== undefined && target !== before) {
            const box = marker.getBoundingClientRect();
            resolve({ target, x: box.x + box.width / 2, y: box.y + box.height / 2 });
          } else {
            requestAnimationFrame(watch);
          }
        };
        requestAnimationFrame(watch);
      }),
    [code, key, previous ?? ''] as const,
  );
  await waitTicks(page, 60); // the player turns and the camera frames the new target
  const box = await page.getByTestId('lock-marker').boundingBox();
  if (box === null) throw new Error('lock marker has no box');
  return { ...sample, settled: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

test('AC-6: locking on and cycling moves the HUD lock marker across all three dummies', async ({
  page,
}) => {
  // GPU-less CI runners draw the testbed at a few frames per second; the waits below are in sim ticks.
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await play(page);
  await expect(page.getByTestId('lock-marker')).toBeHidden();
  await walkTo(page, 15); // through the corridor, into the arena doorway
  await waitTicks(page, 30); // coast to a stop

  const first = await tapAndMark(page, 'KeyQ', 'q', undefined);
  const second = await tapAndMark(page, 'Tab', 'Tab', first.target);
  const third = await tapAndMark(page, 'Tab', 'Tab', second.target);

  const samples = [first, second, third];
  expect(new Set(samples.map((s) => s.target)).size).toBe(3);
  expect((await player(page)).lock).toBe(Number(third.target));
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  // Once framed, every target's marker is on screen. (The first-frame samples below may still be
  // off screen on a slow runner: the camera is framed on the previous target then.)
  for (const { settled } of samples) {
    const { x, y } = settled ?? { x: -1, y: -1 };
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(viewport.width);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(viewport.height);
  }
  // Cycling right from the centre dummy jumps the marker right on screen; the next cycle wraps round
  // to the leftmost dummy, so the marker jumps back left.
  expect(second.x).toBeGreaterThan(first.x + 50);
  expect(third.x).toBeLessThan(second.x - 50);

  await tap(page, 'KeyQ', 'q');
  await expect(page.getByTestId('lock-marker')).toBeHidden();
  expect((await player(page)).lock).toBeNull();
  expect(problems).toEqual([]);
});
