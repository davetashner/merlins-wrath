// Load-time checks of area transitions (mw-e01.11): what a scene file can't check alone. Every
// transition leads to a scene that exists (the loader's reference check says so, naming the
// scene) and to a spawn that scene places (named here: the scene it leaves, the transition, the
// target scene and the spawn). An arrival spawn must not lie inside a volume of its own scene's
// transitions, or the player would arrive standing in a way out.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { SceneDef } from './types/scene.ts';

/** Whether the spawn position `at` (grid cells) lies in the transition volume `box`. */
function inside(
  box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  },
  at: readonly [number, number, number],
): boolean {
  return ([0, 1, 2] as const).every(
    (axis) => at[axis] >= box.min[axis] && at[axis] <= box.max[axis],
  );
}

/** The content check for scenes' transitions. */
export const checkSceneTransitions: ContentCheck = (entries) => {
  const scenes = new Map<string, { file: string; scene: SceneDef }>();
  for (const { type, file, value } of entries) {
    if (type === 'scene') scenes.set(value.id, { file, scene: value as SceneDef });
  }
  const issues: ContentIssue[] = [];
  for (const { file, scene } of scenes.values()) {
    scene.transitions.forEach((transition, index) => {
      const target = scenes.get(transition.scene.id);
      // A missing scene is already reported by the loader's reference check.
      if (target === undefined) return;
      const arrival = target.scene.spawns.find((spawn) => spawn.id === transition.spawn);
      const pointer = `/transitions/${String(index)}/spawn`;
      if (arrival === undefined) {
        issues.push({
          file,
          pointer,
          message: `scene:${scene.id} transition "${transition.id}" arrives at spawn "${transition.spawn}", which scene "${target.scene.id}" (${target.file}) does not place`,
        });
        return;
      }
      const blocking = target.scene.transitions.find((other) => inside(other, arrival.at));
      if (blocking !== undefined) {
        issues.push({
          file,
          pointer,
          message: `scene:${scene.id} transition "${transition.id}" arrives at spawn "${transition.spawn}" of scene "${target.scene.id}", which lies inside that scene's transition "${blocking.id}"`,
        });
      }
    });
  }
  return issues;
};
