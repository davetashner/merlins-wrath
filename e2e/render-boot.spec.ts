import { expect, test, type Page } from '@playwright/test';
import { attachFrame, captureFrame, distinct } from './helpers/canvas';

// mw-e00.19: the renderer + physics bootstrap against the production build (Chromium).

const DPR_CAP = 2; // DEFAULT_MAX_PIXEL_RATIO in src/render/bootstrap/sizing.ts

// The GPU process reports driver performance notices (e.g. "GPU stall due to ReadPixels" under
// software GL in headless Chromium) as page warnings. They come from the browser, not our code, and
// are not errors; real WebGL errors (GL_INVALID_…) still fail the tests.
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

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

/** Resolves after the page has rendered two more animation frames. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

async function drawingBuffer(page: Page): Promise<{ width: number; height: number; dpr: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    const gl = canvas?.getContext('webgl2');
    if (!gl) throw new Error('no WebGL2 canvas');
    return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, dpr: devicePixelRatio };
  });
}

test('AC-1: the built app renders a non-blank first frame with no console errors or warnings', async ({
  page,
}, testInfo) => {
  const problems = collectProblems(page);
  await page.goto('/');

  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-first-frame-ms', /^\d+$/, { timeout: 30_000 });
  // The 3 s first-frame budget is the perf suite's (mw-e41.8, e2e/perf/flows.ts), not asserted here.
  // Physics WASM loads lazily after the first frame; the loading state ends in 'ready'.
  await expect(app).toHaveAttribute('data-physics', 'ready');
  await expect(app).toHaveAttribute('data-physics-version', /^\d+\.\d+\.\d+/);
  await expect(page.getByTestId('physics-status')).toHaveCount(0);

  // Capture the canvas alone, keep it as the boot artifact and count distinct colours on a coarse
  // grid (in the page; a Playwright screenshot costs seconds on a loaded machine, mw-7ou).
  const frame = await captureFrame(page, { png: true });
  await attachFrame(testInfo, 'boot-frame', frame);
  expect(distinct(frame)).toBeGreaterThan(8);

  expect(problems).toEqual([]);
});

for (const deviceScaleFactor of [1, 3]) {
  test.describe(`at devicePixelRatio ${String(deviceScaleFactor)}`, () => {
    test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor });

    test('AC-2: after resizing 1280×720 → 1920×1080 the drawing buffer is viewport × min(dpr, cap)', async ({
      page,
    }) => {
      // At DPR 3 the capped buffer is 3840×2160. CI runners have no GPU, so Chromium renders with
      // SwiftShader on the CPU, and since the testbed's player camera (mw-e02.23, mw-e02.4) fills the whole
      // frame with lit, shadowed geometry (the old overview camera left about three quarters of it
      // background), each frame there takes about 2.5 s. The test waits for six frames or so, which
      // no longer fits the default 30 s. Real GPUs draw the same view in about 3 ms (e2e/perf.spec.ts).
      test.slow(deviceScaleFactor > 1, 'software-rendered 4K frames on GPU-less CI runners');
      const problems = collectProblems(page);
      await page.goto('/');
      await expect(page.locator('#app')).toHaveAttribute('data-first-frame-ms', /^\d+$/);
      const ratio = Math.min(deviceScaleFactor, DPR_CAP);

      await nextFrames(page);
      expect(await drawingBuffer(page)).toEqual({
        width: 1280 * ratio,
        height: 720 * ratio,
        dpr: deviceScaleFactor,
      });

      await page.setViewportSize({ width: 1920, height: 1080 });
      await nextFrames(page);
      expect(await drawingBuffer(page)).toEqual({
        width: 1920 * ratio,
        height: 1080 * ratio,
        dpr: deviceScaleFactor,
      });
      expect(problems).toEqual([]);
    });
  });
}

test('AC-3: with WebAssembly disabled the app shows a readable unsupported-browser screen', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'WebAssembly');
  });
  await page.goto('/');

  const screen = page.getByTestId('unsupported-browser');
  await expect(screen).toBeVisible();
  await expect(screen.getByRole('heading')).toHaveText('This browser cannot run The Vesper Bell');
  await expect(screen).toContainText('WebAssembly is unavailable');
  await expect(page.locator('#app')).toHaveAttribute('data-boot', 'unsupported');
  await expect(page.getByTestId('game-canvas')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('AC-4: disposing and recreating the renderer 5 times does not grow the WebGL context count', async ({
  page,
}) => {
  const problems = collectProblems(page);
  // Count live WebGL contexts: created by getContext, released when the context is lost.
  await page.addInitScript(() => {
    const counts = { created: 0, lost: 0 };
    Object.assign(globalThis, { __glContexts: counts });
    const seen = new WeakSet<object>();
    const proto = HTMLCanvasElement.prototype;
    const original = Reflect.get(proto, 'getContext') as (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement['getContext']>
    ) => RenderingContext | null;
    proto.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement['getContext']>
    ) {
      const context = original.apply(this, args);
      if (context !== null && (args[0] === 'webgl2' || args[0] === 'webgl') && !seen.has(context)) {
        seen.add(context);
        counts.created++;
        this.addEventListener('webglcontextlost', () => counts.lost++, { once: true });
      }
      return context;
    } as HTMLCanvasElement['getContext'];
  });
  await page.goto('/testbed/render.html');
  const live = (): Promise<number> =>
    page.evaluate(() => {
      const { created, lost } = (
        globalThis as unknown as { __glContexts: { created: number; lost: number } }
      ).__glContexts;
      return created - lost;
    });

  await page.click('#recreate');
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-state', 'done');
  await expect(status).toHaveAttribute('data-cycles', '5');

  await expect.poll(live).toBe(1);
  await expect(page.locator('#stage canvas')).toHaveCount(1);
  expect(problems).toEqual([]);
});
