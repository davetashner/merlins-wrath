// The placeholder report (mw-e28.2 AC-4): every sound manifest entry still flagged
// `placeholder: true`, with its bus and variant count, and the totals, so the asset group can
// prioritise prompt beads. Run through placeholder-report-cli.ts (`pnpm audio:placeholder-report`).

import { readManifest, type ManifestEntry } from './gen-placeholders.ts';

/** The report's lines for a manifest. */
export function placeholderReport(manifest: readonly ManifestEntry[]): string[] {
  const placeholders = manifest.filter((entry) => entry.placeholder === true);
  const files = placeholders.reduce((sum, entry) => sum + entry.variants.length, 0);
  return [
    ...placeholders.map(
      (entry) =>
        `${entry.id}  (${entry.bus}, ${String(entry.variants.length)} variant${entry.variants.length === 1 ? '' : 's'})`,
    ),
    `Total: ${String(placeholders.length)} placeholder sounds (${String(files)} files) of ${String(manifest.length)} manifest entries.`,
  ];
}

/** Prints the report for the committed manifest. Returns the exit code. */
export function main(root: string = process.cwd()): number {
  for (const line of placeholderReport(readManifest(root))) console.log(line);
  return 0;
}
