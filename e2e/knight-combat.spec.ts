import { expect, test, type Page } from '@playwright/test';

// mw-e04.6 AC-7: the knight's light chain in ?scene=testbed against the production build (Chromium).
// The page publishes the player's combat state on #app[data-player] (`combat.action`: the move in
// progress) after every sim tick, and the testbed training dummy's health on #app[data-dummy]; the
// test only reads them. The attack action is issued the way a player issues it: real mouse button
// events (left button, primaryAttack) through the game's own listeners while the pointer is locked
// (headless Chromium refuses pointer lock, so an init script grants it as a browser does).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface DummyData {
  health: number;
  max: number;
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

async function dummy(page: Page): Promise<DummyData> {
  const json = await page.locator('#app').getAttribute('data-dummy');
  return JSON.parse(json ?? 'null') as DummyData;
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
  await expect(app).toHaveAttribute('data-dummy', /"health":200/);
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
}

test('AC-7: three attacks run the light chain and take 20 + 22 + 30 = 72 from the dummy, with no console errors', async ({
  page,
}) => {
  // Three swings of the light chain are about 150 sim ticks, which take 15 s or more when CI's software
  // renderer runs the sim at about ten ticks a second, so the default 30 s is too tight.
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await play(page);
  // Taking control must not have swung.
  expect((await dummy(page)).health).toBe(200);
  // In the page, so each press follows the sim tick by tick: click (down, then up a frame later),
  // wait for the swing to finish, click again — well inside the chain's 30 idle ticks — three times.
  const { moves, barValues } = await page.evaluate(
    () =>
      new Promise<{ moves: string[]; barValues: string[] }>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const action = () =>
          (
            JSON.parse(app?.dataset['player'] ?? '{}') as {
              combat?: { action: string | null };
            }
          ).combat?.action ?? null;
        const mouse = (type: string) => {
          window.dispatchEvent(new MouseEvent(type, { button: 0 }));
        };
        const seen: string[] = [];
        // mw-e04.21: the target bar's health as the page shows it, each time it changes.
        const barValues: string[] = [];
        const bar = () => {
          const meter = document.querySelector<HTMLElement>('[data-testid=target-bar]');
          const value = meter?.hidden === false ? meter.querySelector('[role=meter]') : null;
          const now = value?.getAttribute('data-value');
          if (now != null && barValues.at(-1) !== now) barValues.push(now);
        };
        let presses = 0;
        let state: 'press' | 'release' | 'swinging' = 'press';
        const watch = () => {
          bar();
          const now = action();
          if (now !== null && seen.at(-1) !== now) seen.push(now);
          if (state === 'press' && now === null) {
            if (presses === 3) {
              resolve({ moves: seen, barValues });
              return;
            }
            mouse('mousedown');
            presses += 1;
            state = 'release';
          } else if (state === 'release') {
            mouse('mouseup');
            state = 'swinging';
          } else if (state === 'swinging' && now !== null) {
            state = 'press';
          }
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }),
  );
  expect(moves).toEqual(['sword-light-1', 'sword-light-2', 'sword-light-3']);
  await expect.poll(async () => (await dummy(page)).health).toBe(200 - 72);
  // mw-e04.21: the fighter the player hit had its health bar up, reading what the dummy lost.
  expect(barValues).toEqual(['180', '158', '128']);
  expect(problems).toEqual([]);
});
