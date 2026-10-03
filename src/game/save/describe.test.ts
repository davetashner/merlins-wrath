// mw-e30.14: a save's slot description names the player's real class, not a hardcoded Knight.
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { World } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../capabilities';
import { applyClass, createClassRules } from '../classes';
import { installFactRegistry } from '../facts';
import { deathSaveEntry } from './death/controller';
import { describeSave, NO_CLASS } from './describe';
import { loadEntry } from './menus/controller';
import { createGameSaveRegistry } from './sections';
import { SaveSlots } from './slots/index';
import { MemorySaveStore } from './storage/index';

const content = loadGameContent();
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const NOW = 1_790_000_000_000;

function player() {
  const world = new World<never>({ seed: 5 });
  installFactRegistry(world.facts, content, true);
  const actor = world.spawn();
  const rules = createClassRules(content, createCapabilityRegistry(content, true));
  return { world, actor, rules };
}

describe('save slot descriptions (mw-e30.14)', () => {
  it('mw-e30.14 AC-1: a save made as a thief shows Thief in its slot description', async ({
    task,
  }) => {
    markExercised(task, 'class', 'thief');
    const { world, actor, rules } = player();
    applyClass(world, actor, 'thief', rules);
    const description = describeSave(world, actor, content, 'slice');
    expect(description).toEqual({ characterName: 'Thief', classId: 'thief', areaId: 'slice' });

    // Saved and listed again, the Load screen's and death screen's rows say Thief.
    const slots = new SaveSlots({
      store: new MemorySaveStore(),
      registry: createGameSaveRegistry(),
      build,
      now: () => NOW,
    });
    await slots.overwrite('manual-1', world, description);
    const [summary] = await slots.list(['manual-1']);
    if (summary?.state !== 'ready') throw new Error('the save did not list');
    expect(summary.details).toMatchObject({ characterName: 'Thief', classId: 'thief' });
    const save = { ...summary, damaged: false };
    expect(loadEntry(save, NOW).detail).toBe('Thief · slice · 0:00 played · just now');
    expect(deathSaveEntry(save, NOW).detail).toMatch(/^Thief · /);
  });

  it('names the knight as Knight, and no one before a class is chosen', () => {
    const { world, actor, rules } = player();
    expect(describeSave(world, actor, content, 'slice')).toEqual({
      characterName: '',
      classId: NO_CLASS,
      areaId: 'slice',
    });
    expect(describeSave(world, undefined, content, '')).toEqual({
      characterName: '',
      classId: 'none',
      areaId: '',
    });
    applyClass(world, actor, 'knight', rules);
    expect(describeSave(world, actor, content, 'slice').characterName).toBe('Knight');
  });

  it('falls back to the class id for a class content no longer has', () => {
    const { world, actor, rules } = player();
    applyClass(world, actor, 'knight', rules);
    const without = { get: content.get.bind(content), has: () => false };
    expect(describeSave(world, actor, without, 'slice')).toMatchObject({
      characterName: 'knight',
      classId: 'knight',
    });
  });

  it('a save made before a class is chosen lists without a character', async () => {
    const { world, actor } = player();
    const slots = new SaveSlots({
      store: new MemorySaveStore(),
      registry: createGameSaveRegistry(),
      build,
      now: () => NOW,
    });
    await slots.overwrite('auto-1', world, describeSave(world, actor, content, 'testbed'));
    const [summary] = await slots.list(['auto-1']);
    if (summary?.state !== 'ready') throw new Error('the save did not list');
    expect(deathSaveEntry({ ...summary, damaged: false }, NOW).detail).toBe(
      'testbed · 0:00 played · just now',
    );
  });
});
