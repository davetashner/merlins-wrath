// Frozen test-fixture content (mw-e12.3): grey-box creatures that AI and stealth rule tests spawn
// instead of bestiary creatures, so tuning the bestiary never breaks a rule test. The files live in
// src/content/fixtures/creatures/<type>/, outside the game's content root, so the game bundle (which
// globs only ./data, see game-content.ts) never includes them. Changing a fixture value requires
// updating the scenario tests that depend on it (see the README next to the files).
// Test-only: not exported from index.ts, so nothing in the game imports it.

import { gameContentSources } from './game-content.ts';
import { loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes, type GameContent } from './registry.ts';

const files = import.meta.glob<string>('./fixtures/creatures/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Where the fixture files live, relative to the repo root. */
export const FIXTURE_CONTENT_ROOT = 'src/content/fixtures/creatures';

/** The frozen fixture creature ids. */
export const FIXTURE_CREATURE_IDS = ['fixture-guard', 'fixture-hound', 'fixture-sentinel'] as const;

/** A fixture creature id. */
export type FixtureCreatureId = (typeof FIXTURE_CREATURE_IDS)[number];

/** Every fixture file, with repo-relative paths. */
export function fixtureContentSources(): ContentSource[] {
  return Object.entries(files).map(([path, text]) => ({
    path: `${FIXTURE_CONTENT_ROOT}/${path.slice('./fixtures/creatures/'.length)}`,
    text,
  }));
}

/**
 * The game's content plus the test fixtures, loaded and validated together (fixtures refer to the
 * baseline `sense` and `locomotion` profiles). Throws a ContentLoadError listing every problem.
 */
export function loadFixtureContent(): GameContent {
  return loadContent(
    contentTypes,
    [...gameContentSources(), ...fixtureContentSources()],
    contentChecks,
  );
}
