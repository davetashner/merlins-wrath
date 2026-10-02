// The placeholder report (mw-e29.2 AC-4): every VFX texture manifest entry still flagged
// `placeholder: true`, with its size and frame grid, and the totals, so the asset group can see what
// final art is still owed. Run through placeholder-report-cli.ts (`pnpm vfx:placeholder-report`).

import type { VfxTextureEntry } from '../../src/game/vfx/textures.ts';
import { readManifest } from './gen-placeholders.ts';

/** The report's lines for a manifest. */
export function placeholderReport(manifest: readonly VfxTextureEntry[]): string[] {
  const placeholders = manifest.filter((entry) => entry.placeholder);
  return [
    ...placeholders.map((entry) => {
      const grid =
        entry.cols * entry.rows > 1 ? `, ${String(entry.cols)}×${String(entry.rows)} frames` : '';
      return `${entry.id}  (${String(entry.width)}×${String(entry.height)}${grid})`;
    }),
    `Total: ${String(placeholders.length)} placeholder VFX textures of ${String(manifest.length)} manifest entries.`,
  ];
}

/** Prints the report for the committed manifest. Returns the exit code. */
export function main(root: string = process.cwd()): number {
  for (const line of placeholderReport(readManifest(root))) console.log(line);
  return 0;
}
