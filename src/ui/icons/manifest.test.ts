import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { loadItemFixtureContent } from '@content/test-fixtures';
import { itemIconProblems } from '@content/index';
import { iconManifest, iconManifestSchema } from './manifest.ts';

describe('UI icon manifest (mw-e17.2)', () => {
  it('is valid: icon asset ids, each listed once', () => {
    expect(iconManifest().length).toBeGreaterThan(0);
    const dup = { id: 'icon-item-pebble-01', placeholder: true };
    expect(iconManifestSchema.safeParse([dup, dup]).error?.issues[0]?.message).toBe(
      'duplicate icon id "icon-item-pebble-01"',
    );
    expect(iconManifestSchema.safeParse([{ id: 'pebble', placeholder: true }]).success).toBe(false);
  });

  it('lists every icon the game’s and the fixture items name (placeholders allowed)', () => {
    const ids = iconManifest().map(({ id }) => id);
    expect(itemIconProblems(loadGameContent().all('item'), ids)).toEqual([]);
    const fixtures = loadItemFixtureContent().all('item');
    expect(fixtures.length).toBeGreaterThan(0);
    expect(itemIconProblems(fixtures, ids)).toEqual([]);
  });
});
