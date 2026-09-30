// Scenes (mw-e00.21): a level as data. A scene places level-kit pieces on a grid and lists entity
// spawns (markers such as the player start, and props). The scene loader (src/sim/scene) turns it
// into sim entities and static colliders, and src/game binds render objects to them. Kept small on
// purpose so scenes can be written by hand or, later, exported from Blender via glTF extras.
//
// Grid snapping: `at` is in grid cells (`grid` metres each) and must be a multiple of
// SCENE_SNAP_STEP; rotation is a yaw in quarter turns. Every piece and prop a scene names must exist
// (checked by the content loader through `ref`).

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { worldPropertiesSchema } from '../world-properties.ts';
import { interactableSchema } from './interaction.ts';
import { KIT_PURPOSES, vec3Schema } from './kit.ts';

/** Placements snap to this fraction of a grid cell. */
export const SCENE_SNAP_STEP = 0.25;

/** Allowed yaw rotations, degrees about +y (counter-clockwise seen from above). */
export const SCENE_YAWS = [0, 90, 180, 270] as const;
export type SceneYaw = (typeof SCENE_YAWS)[number];

const onGrid = (n: number): boolean => Number.isInteger(n / SCENE_SNAP_STEP);

const gridPosition = vec3Schema
  .refine((at) => at.every(onGrid), {
    message: `must snap to the grid: every coordinate a multiple of ${String(SCENE_SNAP_STEP)} cells`,
  })
  .describe('Position in grid cells (x, y, z), snapped to SCENE_SNAP_STEP.');

const yaw = z
  .literal(SCENE_YAWS)
  .default(0)
  .describe('Rotation about +y in degrees: 0, 90, 180 or 270.');

/** Horizontal sides of a part, in the piece's own axes (before the placement's yaw). */
export const LEDGE_SIDES = ['+x', '-x', '+z', '-z'] as const;

/**
 * Switches auto-detected ledges off, or forces them on, for one edge or several (mw-e03.22). Ledges
 * are the top edges of solid boxes with a drop beneath them; see src/sim/climb/ledges.ts.
 */
export const ledgeOverrideSchema = z.strictObject({
  side: z
    .enum(LEDGE_SIDES)
    .optional()
    .describe(
      'Top edge on this side of the piece (its own axes, before yaw); omit for every side.',
    ),
  part: z
    .int()
    .min(0)
    .optional()
    .describe('Index of the part in the kit piece; omit for every part.'),
  ledge: z
    .boolean()
    .describe('false: never a ledge (decoration); true: always a ledge (the whole edge).'),
});

export const scenePlacementSchema = z.strictObject({
  piece: ref('kit').describe('Id of the kit piece.'),
  at: gridPosition,
  yaw,
  scale: z
    .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
    .default([1, 1, 1])
    .describe('Stretch along the piece’s own x, y, z (e.g. a 2 m floor tile scaled 5× is 10 m).'),
  purpose: z.enum(KIT_PURPOSES).optional().describe('Overrides the piece’s purpose (colour code).'),
  properties: worldPropertiesSchema
    .optional()
    .describe(
      'World properties of the piece over the level material, e.g. { "climbable": "ivy" } or a wooden material.',
    ),
  ledges: z
    .array(ledgeOverrideSchema)
    .optional()
    .describe('Ledge overrides, applied in order (a later one wins over an earlier one).'),
});

export const sceneSpawnSchema = z.strictObject({
  id: contentId.describe('Name of the spawn, unique in the scene (e.g. player-start).'),
  at: gridPosition,
  yaw,
  prop: ref('testprop').optional().describe('Prop to spawn; without one the spawn is a marker.'),
  tags: z.array(z.string().min(1)).default([]).describe('Free-form tags for systems and tools.'),
  interact: interactableSchema
    .optional()
    .describe('Makes the spawned entity interactable: its affordances (mw-e02.5).'),
  targetable: ref('targetable')
    .optional()
    .describe('Makes the spawned entity a lock-on target with this profile (mw-e02.16).'),
});

const cameraSchema = z.strictObject({
  position: vec3Schema.describe('Camera position in metres.'),
  target: vec3Schema.describe('Point the camera looks at, metres.'),
});

export const sceneSchema = z
  .strictObject({
    id: contentId.describe('Scene id; also the ?scene= URL value.'),
    name: z.string().min(1).describe('Display name shown on screen.'),
    description: z.string().default('').describe('What the scene is for.'),
    grid: z.number().positive().default(1).describe('Size of one grid cell in metres.'),
    camera: cameraSchema.describe('Where the view camera starts.'),
    placements: z.array(scenePlacementSchema).min(1).describe('Kit pieces in the scene.'),
    spawns: z.array(sceneSpawnSchema).default([]).describe('Entity spawns: markers and props.'),
  })
  .superRefine((scene, ctx) => {
    const seen = new Set<string>();
    scene.spawns.forEach((spawn, index) => {
      if (seen.has(spawn.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawns', index, 'id'],
          message: `spawn id "${spawn.id}" is used twice in this scene`,
        });
      }
      seen.add(spawn.id);
    });
  });

export type SceneDef = z.output<typeof sceneSchema>;
export type SceneDefInput = z.input<typeof sceneSchema>;
export type ScenePlacementDef = z.output<typeof scenePlacementSchema>;
export type SceneSpawnDef = z.output<typeof sceneSpawnSchema>;
