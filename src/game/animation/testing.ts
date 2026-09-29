// Test helpers for the animation glue (mw-e02.20): a sim world running the action timeline with one
// test move ("swing", 12/4/18 ticks, clip anim-swing whose hit marker is at 0.40 s) and the runtime
// test rig. Test-only; not exported from index.ts.

import { compileMoves, moveSchema, type MoveDefInput, type MoveTable } from '@content/index';
import { AnimationController } from '@render/animation/index';
import { testGraph } from '@render/animation/fixtures';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionTimelineSystem,
  giveActionTimeline,
  StaminaComponent,
  World,
  type EntityId,
} from '@sim/index';

/** A hitting move with the given frames and clip. */
export function testMove(
  id: string,
  [startup, active, recovery]: readonly [number, number, number],
  anim: string,
): MoveDefInput {
  return {
    id,
    notes: 'Animation test move.',
    verb: 'attack',
    frames: { startup, active, recovery },
    damage: { amounts: { slash: 1 } },
    hitbox: {
      track: `${id}-track`,
      shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 },
      reach: 'short',
      swing: 'horizontal',
    },
    presentation: { anim },
  };
}

/** The move table of the test moves. */
export function testMoves(...moves: MoveDefInput[]): MoveTable {
  return compileMoves(moves.map((m) => moveSchema.parse(m)));
}

/** "swing": first active tick 12, 34 ticks long, plays anim-swing (hit marker 0.40 s). */
export const SWING = testMove('swing', [12, 4, 18], 'anim-swing');

/** A world with the action timeline over `moves` and one entity that has a timeline. */
export function timelineWorld(moves: MoveTable = testMoves(SWING)): {
  world: World;
  entity: EntityId;
  moves: MoveTable;
} {
  const world = new World({ seed: 1 }).register(...ACTION_TIMELINE_COMPONENTS, StaminaComponent);
  world.addSystem(actionTimelineSystem({ moves }));
  const entity = world.spawn();
  giveActionTimeline(world, entity);
  return { world, entity, moves };
}

/** A controller over the runtime's test rig. */
export const testController = (): AnimationController => new AnimationController(testGraph());
