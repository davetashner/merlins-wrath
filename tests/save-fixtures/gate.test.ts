// The save-schema gate (mw-e30.3, backlog contract §3), run on every CI build: the committed schema
// lock must match this build's save sections, and every committed fixture — from every revision,
// oldest first — must load through the current migration chain into a world that passes its
// invariants. On failure the message says exactly what to do (bump + migrate + pnpm save:fixture).
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '@game/save/sections';
import { checkSaveFixtures, listFixtures, loadFixtureFile } from '@tools/save-fixtures/files';

const root = process.cwd();
const fixtures = Object.values(listFixtures(root)).flat();

describe('save schema gate', () => {
  it('AC-2/AC-3: the schema lock matches every save section and each revision has fixtures', () => {
    const problems = checkSaveFixtures(root, createGameSaveRegistry());
    expect(problems.map((problem) => problem.message).join('\n')).toBe('');
  });

  it('AC-1: finds fixtures for revision 1', () => {
    expect(fixtures.filter((path) => path.includes('/1/')).length).toBeGreaterThan(0);
  });

  it.each(fixtures)('AC-1: %s loads under the current build and passes invariants', (path) => {
    const { world } = loadFixtureFile(root, path, createGameSaveRegistry());
    expect(world.tick).toBeGreaterThan(0);
  });
});
