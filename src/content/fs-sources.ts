// Node-side reader for content files (mw-e00.18), for tools and tests that run outside Vite (the app
// uses import.meta.glob in game-content.ts). Not exported from index.ts: it needs node:fs.

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentSource } from './loader.ts';

/**
 * Reads every `<root>/<type>/*.json` file, sorted by path. Paths in the result (and so in error
 * messages) are `label` (default: `root`) joined with the relative file path, with forward slashes.
 */
export function readContentSources(root: string, label: string = root): ContentSource[] {
  return globSync('*/*.json', { cwd: root })
    .map((file) => file.replaceAll('\\', '/'))
    .sort()
    .map((file) => ({ path: `${label}/${file}`, text: readFileSync(join(root, file), 'utf8') }));
}
