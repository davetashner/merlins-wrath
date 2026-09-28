// Loads the game's content from src/content/data/ (mw-e00.18). Vite's eager import.meta.glob inlines
// every data file as raw text at build time (Vitest supports the same), so the app and the tests load
// exactly the same files through the same validation. Node tools use fs-sources.ts instead.

import { loadContent, type ContentSource } from './loader.ts';
import { contentTypes, type GameContent } from './registry.ts';

const files = import.meta.glob<string>('./data/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Where the game's content lives, relative to the repo root (used in error messages). */
export const GAME_CONTENT_ROOT = 'src/content/data';

/** Every game content file, with repo-relative paths. */
export function gameContentSources(): ContentSource[] {
  return Object.entries(files).map(([path, text]) => ({
    path: `${GAME_CONTENT_ROOT}/${path.slice('./data/'.length)}`,
    text,
  }));
}

/** Loads and validates the game's content; throws a ContentLoadError listing every problem. */
export function loadGameContent(): GameContent {
  return loadContent(contentTypes, gameContentSources());
}
