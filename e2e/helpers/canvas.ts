// Canvas capture for e2e checks (mw-7ou): reads the game canvas's pixels in the page instead of
// taking Playwright screenshots and decoding them back in the page, which cost seconds per shot on a
// loaded machine and made full local runs time out.
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';

export interface Frame {
  /** A 64×36 RGB sample of the frame. */
  rgb: number[];
  /** The whole frame as a PNG data URL, when asked for. */
  png?: string;
}

/**
 * Captures the game canvas in the page, straight after the game has drawn a frame at least `afterMs`
 * after the call: rAF callbacks run in registration order, so ours follows the game's draw and the
 * WebGL drawing buffer still holds that frame. Reading pixels here instead of taking Playwright
 * screenshots keeps the check cheap on a loaded machine (mw-7ou): a canvas screenshot waits on the
 * compositor for fresh frames, and the test used to decode each PNG back in the page. The canvas
 * holds only the scene, so the overlay text never needs hiding.
 */
export function captureFrame(
  page: Page,
  options: { afterMs?: number; png?: boolean } = {},
): Promise<Frame> {
  return page.evaluate(
    async ({ afterMs, png }) => {
      const source = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
      if (!source) throw new Error('no game canvas');
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const full = copy.getContext('2d');
      if (!full) throw new Error('no 2d context');
      await new Promise<void>((resolve) => {
        let start: number | undefined;
        const frame = (time: number): void => {
          start ??= time;
          if (time - start < afterMs) {
            requestAnimationFrame(frame);
            return;
          }
          full.drawImage(source, 0, 0);
          resolve();
        };
        requestAnimationFrame(frame);
      });
      const small = document.createElement('canvas');
      small.width = 64;
      small.height = 36;
      const ctx = small.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(copy, 0, 0, 64, 36);
      const { data } = ctx.getImageData(0, 0, 64, 36);
      const rgb: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        rgb.push(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
      }
      return png ? { rgb, png: copy.toDataURL('image/png') } : { rgb };
    },
    { afterMs: options.afterMs ?? 0, png: options.png ?? false },
  );
}

/** Writes a capture's PNG next to the test's output and attaches it to the report. */
export async function attachFrame(testInfo: TestInfo, name: string, frame: Frame): Promise<void> {
  const body = Buffer.from((frame.png ?? '').replace(/^data:image\/png;base64,/, ''), 'base64');
  await writeFile(testInfo.outputPath(`${name}.png`), body);
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

/** Distinct colours in a capture's 64×36 sample. */
export function distinct(frame: Frame): number {
  return new Set(frame.rgb).size;
}
