import { describe, expect, it } from 'vitest';
import { readContentSources } from './fs-sources.ts';
import { GAME_CONTENT_ROOT, gameContentSources, loadGameContent } from './game-content.ts';

describe('game content', () => {
  it('bundles exactly the files on disk under src/content/data, with repo-relative paths', () => {
    const bundled = [...gameContentSources()].sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(bundled).toEqual(readContentSources(GAME_CONTENT_ROOT));
    expect(bundled.length).toBeGreaterThan(0);
  });

  it('loads and validates every registered content type', () => {
    const content = loadGameContent();
    expect(content.all('testprop').length).toBeGreaterThan(0);
    expect(content.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
