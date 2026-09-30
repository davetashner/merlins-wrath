import { expect, test, type Page } from '@playwright/test';

// mw-e28.2: the placeholder sound pack is audible in ?scene=testbed against the production build
// (Chromium). The page publishes the audio context state, voices and the latest cues it sent to the
// engine on #app[data-audio]. Nothing may play before the first gesture (autoplay policy); a click
// on the canvas starts the context, and a sword hit on the training dummy plays the struck
// material's impact set, fetched from the placeholder pack without errors.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface AudioData {
  state: string;
  voices: number;
  cues: string[];
}

async function audio(page: Page): Promise<AudioData | null> {
  const json = await page.locator('#app').getAttribute('data-audio');
  return JSON.parse(json ?? 'null') as AudioData | null;
}

test('a sword hit on the dummy plays its placeholder impact sound after the first gesture', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/assets/audio/') && !response.ok()) failed.push(response.url());
  });
  // Headless Chromium refuses pointer lock; grant it as a browser does (see knight-combat.spec.ts).
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
  });
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-dummy', /"health":200/);
  // Before any gesture the context was never started, so nothing has played.
  await expect.poll(async () => (await audio(page))?.state).toBe('uncreated');
  expect((await audio(page))?.cues).toEqual([]);

  await page.getByTestId('game-canvas').click();
  await expect.poll(async () => (await audio(page))?.state).toBe('running');
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    requestAnimationFrame(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    });
  });
  await expect
    .poll(async () => (await audio(page))?.cues.some((cue) => cue.startsWith('sfx-impact-')))
    .toBe(true);
  expect(failed).toEqual([]);
  expect(problems).toEqual([]);
});
