import { describe, expect, it } from 'vitest';
import { DEV_CONTENT_ROOT, devContentSources, loadDevContent } from './dev-content.ts';
import { readContentSources } from './fs-sources.ts';
import { loadGameContent } from './game-content.ts';
import { FIXTURE_CONTENT_ROOT, FIXTURE_CREATURE_IDS } from './test-fixtures.ts';

const byPath = <T extends { path: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.path < b.path ? -1 : 1));

describe('debug-build content (mw-e12.4)', () => {
  it('reads exactly the fixture creatures and the dev-only files', () => {
    expect(byPath(devContentSources())).toEqual(
      byPath([
        ...readContentSources(FIXTURE_CONTENT_ROOT),
        ...readContentSources(DEV_CONTENT_ROOT),
      ]),
    );
  });

  it('loads the game content plus the fixture creatures and the creature pen', () => {
    const content = loadDevContent();
    expect(content.all('creature').map((c) => c.id)).toEqual(
      expect.arrayContaining([...FIXTURE_CREATURE_IDS]),
    );
    const pen = content.get('scene', 'creature-pen');
    expect(pen.spawns.flatMap((s) => (s.creature === undefined ? [] : [s.creature.id]))).toEqual([
      'fixture-hound',
      'fixture-hound',
      'fixture-guard',
      'fixture-sentinel',
    ]);
    // None of it is in the game's own content, whose creatures are the bestiary's (E13).
    expect(loadGameContent().has('scene', 'creature-pen')).toBe(false);
    const shipped = loadGameContent()
      .all('creature')
      .map((c) => c.id);
    for (const fixture of FIXTURE_CREATURE_IDS) expect(shipped).not.toContain(fixture);
  });
});
