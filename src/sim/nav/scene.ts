// What a scene gives the navmesh bake (mw-e11.4): its solid kit parts (with the climb grade of the
// piece they belong to, from its world properties over the level material) and its doors' closed
// leaves. Door leaves are not solids: a doorway is walkable, and the door's state decides at query
// time (./doors.ts). Movable props are not baked either; they are dynamic obstacles.

import { CLIMB_GRADE_RULES } from '../climb/surfaces';
import { closedBox } from '../mechanisms/geometry';
import type { DoorProfileLookup } from '../mechanisms/components';
import { resolveProperties, type MaterialPresets } from '../properties/materials';
import { DEFAULT_LEVEL_MATERIAL, placementProperties } from '../scene/physics';
import type { SceneLayout } from '../scene/layout';
import type { NavBakeDoor, NavBakeInput, NavBakeSolid } from './bake';
import { at } from './util';

/** What `sceneNavBakeInput` reads besides the layout. */
export interface SceneNavOptions {
  /** Door profiles, to size each door's leaf. */
  readonly doors: DoorProfileLookup;
  /** Material presets, for the pieces' climb grades. */
  readonly materials: MaterialPresets;
  /** Material of the level geometry; defaults to DEFAULT_LEVEL_MATERIAL. */
  readonly levelMaterial?: string;
}

/**
 * The bake input of a laid-out scene (see the file header).
 * @throws RangeError for a door profile `doors` does not have or an unknown material.
 */
export function sceneNavBakeInput(layout: SceneLayout, options: SceneNavOptions): NavBakeInput {
  const level = options.levelMaterial ?? DEFAULT_LEVEL_MATERIAL;
  const grades = layout.pieces.map((piece) => {
    const own = placementProperties(piece.properties);
    const grade = resolveProperties(options.materials, { material: level, ...own }).climbable;
    return grade === 'none' ? undefined : CLIMB_GRADE_RULES[grade].difficulty;
  });
  const solids: NavBakeSolid[] = [];
  for (const part of layout.parts) {
    if (part.collider === undefined) continue;
    const climbGrade = at(grades, part.placement);
    solids.push(
      climbGrade === undefined ? { shape: part.collider } : { shape: part.collider, climbGrade },
    );
  }
  const doors: NavBakeDoor[] = [];
  for (const spawn of layout.spawns) {
    if (spawn.door === undefined) continue;
    const profile = options.doors(spawn.door.profile);
    if (profile === undefined) throw new RangeError(`unknown door profile "${spawn.door.profile}"`);
    const bounds = closedBox({
      kind: profile.kind,
      size: profile.size,
      origin: spawn.position,
      yaw: spawn.yaw,
      hinge: spawn.door.hinge ?? 'left',
      swing: spawn.door.swing ?? 'forward',
    });
    doors.push({ id: spawn.id, bounds });
  }
  return { id: layout.id, solids, doors };
}
