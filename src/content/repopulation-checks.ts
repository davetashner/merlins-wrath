// Load-time check of creature repopulation (mw-ju8.29): a spawn may opt in to `repopulate` only for
// a creature that is not a boss or a gatekeeper. Bosses and gatekeepers are one-time fights, so a
// creature def tagged `boss`, `gatekeeper` or `brute`, or a spawn tagged `boss` or `gatekeeper`,
// cannot return; the issue names the scene, the spawn and the reason.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { CreatureDef } from './types/creature.ts';
import type { SceneDef } from './types/scene.ts';

/** Tags that make a creature (or the spawn that places it) a one-time encounter. */
const ONE_TIME_CREATURE_TAGS = ['boss', 'gatekeeper', 'brute'] as const;
const ONE_TIME_SPAWN_TAGS = ['boss', 'gatekeeper'] as const;

/** The content check for scenes' `repopulate` spawns. */
export const checkRepopulation: ContentCheck = (entries) => {
  const creatures = new Map<string, CreatureDef>();
  for (const { type, value } of entries) {
    if (type === 'creature') creatures.set(value.id, value as CreatureDef);
  }
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'scene') continue;
    const scene = value as SceneDef;
    scene.spawns.forEach((spawn, index) => {
      if (spawn.repopulate === undefined || spawn.creature === undefined) return;
      const def = creatures.get(spawn.creature.id);
      const byCreature = ONE_TIME_CREATURE_TAGS.filter((tag) => def?.tags.includes(tag));
      const bySpawn = ONE_TIME_SPAWN_TAGS.filter((tag) => spawn.tags.includes(tag));
      const why =
        byCreature.length > 0
          ? `creature "${spawn.creature.id}" is tagged ${byCreature.join('/')}`
          : bySpawn.length > 0
            ? `the spawn is tagged ${bySpawn.join('/')}`
            : undefined;
      if (why === undefined) return;
      issues.push({
        file,
        pointer: `/spawns/${String(index)}/repopulate`,
        message: `scene:${scene.id} spawn "${spawn.id}" repopulates, but ${why}: bosses and gatekeepers are one-time fights`,
      });
    });
  }
  return issues;
};
