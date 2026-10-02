// Canvas capture for e2e checks (mw-7ou): reads the game canvas's pixels in the page instead of
// taking Playwright screenshots and decoding them back in the page, which cost seconds per shot on a
// loaded machine and made full local runs time out.
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';

export interface Frame {
  /** A 64×36 RGB sample of the frame. */
  rgb: number[];
  /** Luma (0–255) around each requested point, averaged over 5×5 pixels of the full frame. */
  luma?: number[];
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
  options: {
    afterMs?: number;
    png?: boolean;
    /** Points in normalised device coordinates (−1…1, +y up) to read luma at. */
    points?: readonly { x: number; y: number }[];
  } = {},
): Promise<Frame> {
  return page.evaluate(
    async ({ afterMs, png, points }) => {
      const source = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
      if (!source) throw new Error('no game canvas');
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const full = copy.getContext('2d', { willReadFrequently: points.length > 0 });
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
      const luma = points.map(({ x, y }) => {
        const px = Math.round(((x + 1) / 2) * copy.width);
        const py = Math.round(((1 - y) / 2) * copy.height);
        const patch = full.getImageData(px - 2, py - 2, 5, 5).data;
        let sum = 0;
        for (let i = 0; i < patch.length; i += 4) {
          sum +=
            0.2126 * (patch[i] ?? 0) + 0.7152 * (patch[i + 1] ?? 0) + 0.0722 * (patch[i + 2] ?? 0);
        }
        return sum / 25;
      });
      const frame = png ? { rgb, png: copy.toDataURL('image/png') } : { rgb };
      return points.length > 0 ? { ...frame, luma } : frame;
    },
    { afterMs: options.afterMs ?? 0, png: options.png ?? false, points: options.points ?? [] },
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
