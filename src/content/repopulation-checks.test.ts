// mw-ju8.29 AC-4: a spawn may opt in to repopulation only for a creature that is not a boss or a
// gatekeeper; the valley opts its 20 ordinary skeletons in and keeps the brute a one-time gatekeeper.
import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { checkRepopulation } from './repopulation-checks.ts';
import { contentChecks, contentTypes } from './registry.ts';

type Json = Record<string, unknown>;

/** Every problem loading the game content with `edit` applied to the file ending `path`. */
function issuesWith(path: string, edit: (json: Json) => void): string[] {
  const sources: ContentSource[] = gameContentSources().map((source) => {
    if (!source.path.endsWith(path)) return source;
    const json = JSON.parse(source.text) as Json;
    edit(json);
    return { ...source, text: JSON.stringify(json) };
  });
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

const spawnOf = (scene: Json, id: string): Json =>
  (scene['spawns'] as Json[]).find((s) => s['id'] === id) ?? expect.fail(id);

describe('repopulation validation (mw-ju8.29)', () => {
  it('AC-4: the valley opts its 20 ordinary skeletons in, and the brute gatekeeper is left out', () => {
    const content = loadGameContent();
    const opted: string[] = [];
    for (const id of ['valley-01', 'valley-02', 'valley-03']) {
      for (const spawn of content.get('scene', id).spawns) {
        if (spawn.creature === undefined) continue;
        if (spawn.repopulate !== undefined) opted.push(spawn.id);
        else expect(spawn.creature.id).toBe('forgotten-brute');
      }
    }
    expect(opted).toHaveLength(20);
    const brute = content
      .get('scene', 'valley-03')
      .spawns.find((s) => s.id === 'skel-valley-03-gate-brute');
    expect(brute?.repopulate).toBeUndefined();
    expect(brute?.tags).toContain('gatekeeper');
  });

  it('AC-4: opting the brute in fails content validation, naming the scene, spawn and reason', () => {
    const issues = issuesWith('scene/valley-03.json', (scene) => {
      spawnOf(scene, 'skel-valley-03-gate-brute')['repopulate'] = { afterDays: 1 };
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('scene:valley-03 spawn "skel-valley-03-gate-brute" repopulates');
    expect(issues[0]).toContain('creature "forgotten-brute" is tagged brute');
  });

  it('AC-4: a spawn tagged boss or gatekeeper cannot repopulate, whatever its creature', () => {
    const issues = issuesWith('scene/valley-01.json', (scene) => {
      const miner = (scene['spawns'] as Json[]).find((s) => s['creature'] === 'forgotten-miner');
      if (miner === undefined) throw new Error('no miner');
      miner['tags'] = ['boss'];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('the spawn is tagged boss');
  });

  it('a creature def tagged boss cannot repopulate either', () => {
    const issues = issuesWith('creature/forgotten-miner.json', (creature) => {
      creature['tags'] = [...(creature['tags'] as string[]), 'boss'];
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('is tagged boss');
  });

  it('repopulate needs a creature, and afterDays is at least 1', () => {
    const noCreature = issuesWith('scene/valley-01.json', (scene) => {
      const [marker] = scene['spawns'] as Json[];
      if (marker !== undefined) marker['repopulate'] = { afterDays: 1 };
    });
    expect(noCreature.join('\n')).toContain('sets repopulate but spawns no creature');
    const zero = issuesWith('scene/valley-01.json', (scene) => {
      const miner = (scene['spawns'] as Json[]).find((s) => s['creature'] === 'forgotten-miner');
      if (miner !== undefined) miner['repopulate'] = { afterDays: 0 };
    });
    expect(zero.join('\n')).toContain('repopulate');
  });

  it('checks nothing in a scene without repopulating spawns', () => {
    expect(checkRepopulation([])).toEqual([]);
  });
});
