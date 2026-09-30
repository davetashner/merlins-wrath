// Debug-build content (mw-e12.4): the game's content plus the frozen fixture creatures
// (src/content/fixtures/creatures) and the dev-only scenes that place them
// (src/content/fixtures/dev), so the grey-box testbed can spawn any creature from data before the
// bestiary (E13) ships real ones. src/main.ts imports this module dynamically only when the debug
// console is built in (`__DEBUG_CONSOLE__`), so a release build (VESPER_DEBUG_CONSOLE=off) never
// includes these files; they are still never part of the game's own content root (./data).

import { gameContentSources } from './game-content.ts';
import { loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes, type GameContent } from './registry.ts';

const creatureFiles = import.meta.glob<string>('./fixtures/creatures/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const devFiles = import.meta.glob<string>('./fixtures/dev/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Where the dev-only content lives, relative to the repo root. */
export const DEV_CONTENT_ROOT = 'src/content/fixtures/dev';

const sources = (files: Record<string, string>): ContentSource[] =>
  Object.entries(files).map(([path, text]) => ({
    path: `src/content/${path.slice('./'.length)}`,
    text,
  }));

/** The fixture creature files and the dev-only files, with repo-relative paths. */
export function devContentSources(): ContentSource[] {
  return [...sources(creatureFiles), ...sources(devFiles)];
}

/** Loads and validates the game's content plus the debug-build content (see the file header). */
export function loadDevContent(): GameContent {
  return loadContent(
    contentTypes,
    [...gameContentSources(), ...devContentSources()],
    contentChecks,
  );
}
