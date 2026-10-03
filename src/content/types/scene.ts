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
import { ITEM_STACK_GUARD } from './item.ts';
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

/**
 * Makes a placement or spawn breakable (mw-e03.11): its profile, what it spills and the passage it
 * opens. Its hit points and impact threshold are its world properties (`hp`, `fragile`).
 */
export const sceneBreakableSchema = z.strictObject({
  profile: ref('breakable').describe('Breakable profile: resistances, debris, break loudness.'),
  contents: z
    .array(ref('testprop'))
    .optional()
    .describe('Props it spills when it breaks (props with a body; mw-e03.39).'),
  reveals: contentId
    .optional()
    .describe('Passage it opens when it breaks: names the passageRevealed event (nav, quests).'),
});

/** Door states a scene can place a door in (mw-e03.18). */
export const SCENE_DOOR_STATES = ['closed', 'open', 'jammed'] as const;

/** Switch kinds (mw-e03.18; the sim's SWITCH_KINDS). */
export const SWITCH_KIND_IDS = ['lever', 'button', 'crank', 'wheel'] as const;

/** Most positions a crank or wheel may have. */
export const MAX_SWITCH_POSITIONS = 8;

/**
 * Makes a spawn a door (mw-e03.18): its profile (kind, size, speed, material, what it shuts out), the
 * lock it carries and how it starts. The door stands in the spawn's doorway: the spawn point is the
 * middle of the bottom of the closed leaf, and the spawn's yaw turns it with its doorway.
 */
export const sceneDoorSchema = z.strictObject({
  profile: ref('door').describe('Door profile: kind, size, speed, material, what it shuts out.'),
  lock: ref('lock')
    .optional()
    .describe('The lock it carries: what keys, picks and spells get past.'),
  locked: z
    .boolean()
    .optional()
    .describe('Starts locked; defaults to true when it has a lock (needs one).'),
  state: z
    .enum(SCENE_DOOR_STATES)
    .default('closed')
    .describe('How it starts: closed, open or jammed.'),
  hinge: z
    .enum(['left', 'right'])
    .default('left')
    .describe(
      'Hinged and trapdoor: the side the hinge is on (−x or +x before yaw); sliding: the side it slides to.',
    ),
  swing: z
    .enum(['forward', 'back'])
    .default('forward')
    .describe('Hinged: swings towards +z (forward) or −z (back) before yaw.'),
});

/**
 * Makes a spawn a switch (mw-e03.18): a lever toggles, a button is momentary, a crank or wheel steps
 * through its positions. Signal graphs read it through lever and button nodes bound to the spawn.
 */
export const sceneSwitchSchema = z.strictObject({
  kind: z.enum(SWITCH_KIND_IDS).describe('lever, button, crank or wheel.'),
  positions: z
    .int()
    .min(2)
    .max(MAX_SWITCH_POSITIONS)
    .optional()
    .describe('Positions it steps through (crank and wheel; a lever has 2, a button none).'),
  initial: z.int().min(0).default(0).describe('Position it starts in (0 = off).'),
});

/**
 * Makes a spawn a lootable container (mw-e18.3): a chest, barrel, bookshelf or corpse. What it holds
 * from the start, plus its loot table rolled once on the first open; both persist with the level.
 */
export const sceneContainerSchema = z.strictObject({
  loot: ref('loot-table')
    .optional()
    .describe(
      'Loot table rolled into it the first time it is opened (once; saves keep the result).',
    ),
  contents: z
    .array(
      z.strictObject({
        item: ref('item').describe('An item it holds from the start.'),
        count: z.int().min(1).max(ITEM_STACK_GUARD).default(1).describe('Units of it; default 1.'),
      }),
    )
    .default([])
    .describe('What it holds from the start, before any roll.'),
  lock: ref('lock')
    .optional()
    .describe('The lock it carries: unlocked and picked like a door’s (mw-e03.18).'),
  locked: z
    .boolean()
    .optional()
    .describe('Starts locked; defaults to true when it has a lock (needs one).'),
});

/**
 * Places a signal graph in the scene (mw-e03.18, mw-e03.21). A node's entity name is a spawn id
 * unless `bindings` maps it to another.
 */
export const sceneSignalSchema = z.strictObject({
  graph: ref('signal-graph').describe('The graph to place.'),
  bindings: z
    .record(contentId, contentId)
    .default({})
    .describe('Binding name → spawn id, for names that are not themselves spawn ids.'),
  checkpoints: z
    .array(contentId)
    .default([])
    .describe(
      'Volume nodes of the graph that are checkpoints: entering one requests an autosave (mw-e30.5).',
    ),
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
  breakable: sceneBreakableSchema
    .optional()
    .describe('Makes the piece breakable, e.g. a cracked wall the knight can smash (mw-e03.11).'),
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
  item: z
    .strictObject({
      id: ref('item').describe('The item lying here.'),
      count: z
        .int()
        .min(1)
        .max(ITEM_STACK_GUARD)
        .default(1)
        .describe('Units in the one world item (a pile of arrows); default 1.'),
    })
    .optional()
    .describe(
      'Places an item here as a world item the player can take, drop and throw (mw-e17.7).',
    ),
  creature: ref('creature')
    .optional()
    .describe('Creature to spawn here (mw-e12.4); faces the spawn’s yaw.'),
  faction: ref('faction')
    .optional()
    .describe('Faction the spawned creature joins instead of its definition’s (needs creature).'),
  patrol: z
    .array(gridPosition)
    .min(1)
    .optional()
    .describe(
      'Patrol route for the spawned creature: waypoints in grid cells, walked in order (needs creature; AI, e11, walks it).',
    ),
  properties: worldPropertiesSchema
    .optional()
    .describe(
      'World properties of the spawned entity, e.g. a torch: { "burning": true, "fuel": 3600 } (mw-e03.37). A spawn with properties is placed in the sim, so the light field and stimuli reach it.',
    ),
  breakable: sceneBreakableSchema
    .optional()
    .describe(
      'Makes the spawned entity breakable, e.g. a pot that spills its contents (mw-e03.11).',
    ),
  door: sceneDoorSchema
    .optional()
    .describe('Makes the spawned entity a door: profile, lock and starting state (mw-e03.18).'),
  switch: sceneSwitchSchema
    .optional()
    .describe('Makes the spawned entity a lever, button, crank or wheel (mw-e03.18).'),
  container: sceneContainerSchema
    .optional()
    .describe(
      'Makes the spawned entity a lootable container: loot table, contents and lock (mw-e18.3).',
    ),
});

const lightLevel = z.number().min(0).max(1);

/** A box of the scene with its own ambient light (mw-e03.37; see src/sim/light/field.ts). */
export const sceneAmbientZoneSchema = z
  .strictObject({
    id: contentId.describe('Name of the zone, e.g. moonlit-yard.'),
    min: vec3Schema.describe('Lower corner, grid cells.'),
    max: vec3Schema.describe('Upper corner, grid cells; above min on every axis.'),
    level: lightLevel.describe('Ambient level inside, 0–1.'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/** Light from far away along one direction: moonlight, sun (mw-e03.37). */
export const sceneDirectionalLightSchema = z.strictObject({
  id: contentId.describe('Name of the light, e.g. moon.'),
  direction: vec3Schema
    .refine((d) => d.some((v) => v !== 0), { message: 'direction must not be zero' })
    .describe('Direction the light travels, e.g. [0, -1, 0] straight down.'),
  level: lightLevel.describe('Level where it reaches, 0–1.'),
  reach: z
    .number()
    .positive()
    .describe('How far back towards the light a position must be clear to receive it, metres.'),
});

/**
 * The scene's static lighting (mw-e03.37), loaded into the sim's light field; the renderer mirrors
 * it. Without it a scene is dark apart from its light-emitting and burning entities.
 */
export const sceneLightSchema = z.strictObject({
  ambient: lightLevel.optional().describe('Ambient level wherever no ambient zone applies, 0–1.'),
  ambientZones: z
    .array(sceneAmbientZoneSchema)
    .default([])
    .describe('Boxes with their own ambient level; later zones win where they overlap.'),
  directional: z
    .array(sceneDirectionalLightSchema)
    .default([])
    .describe('Directional lights (moon, sun); the brightest is the rendered key light.'),
});

/** The room id that stands for everywhere outside the scene's rooms (open terrain). */
export const OUTSIDE_ROOM = 'outside';

const roomRef = contentId.describe(`A room id of this scene, or "${OUTSIDE_ROOM}".`);

/** A room for sound propagation: an axis-aligned box (mw-e09.3). */
export const sceneRoomSchema = z
  .strictObject({
    id: contentId
      .refine((id) => id !== OUTSIDE_ROOM, { message: `"${OUTSIDE_ROOM}" is reserved` })
      .describe('Name of the room, unique in the scene, e.g. guard-room.'),
    min: vec3Schema.describe('Lower corner, grid cells.'),
    max: vec3Schema.describe('Upper corner, grid cells; above min on every axis.'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/** An opening sound passes through between two rooms: a doorway, an arch, a hatch (mw-e09.3). */
export const scenePortalSchema = z.strictObject({
  id: contentId.describe('Name of the portal, unique in the scene, e.g. guard-room-door.'),
  rooms: z
    .tuple([roomRef, roomRef])
    .describe(`The two rooms it joins (one may be "${OUTSIDE_ROOM}").`),
  at: vec3Schema.describe(
    'Its middle, grid cells: where a listener on the far side hears a sound come from.',
  ),
  door: z
    .string()
    .min(1)
    .optional()
    .describe('Spawn id of the door in it; its state (open, ajar, closed) sets the loss.'),
});

/** The material of the wall or floor between two touching rooms (mw-e09.3). */
export const scenePartitionSchema = z.strictObject({
  rooms: z.tuple([contentId, contentId]).describe('The two touching rooms.'),
  material: contentId.describe(
    'Material id of what separates them; its wall or floor gain comes from the stealth tuning.',
  ),
});

/**
 * The scene's rooms and portals for sound propagation (mw-e09.3). Rooms that touch (side by side:
 * a wall; stacked: a floor) transmit through their partition; everything else goes through portals.
 */
export const sceneAcousticsSchema = z.strictObject({
  rooms: z.array(sceneRoomSchema).default([]).describe('Rooms; they must not overlap.'),
  portals: z.array(scenePortalSchema).default([]).describe('Openings between rooms.'),
  partitions: z
    .array(scenePartitionSchema)
    .default([])
    .describe('Materials of partitions between touching rooms; the rest use the tuning default.'),
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
    light: sceneLightSchema
      .optional()
      .describe('Static lighting: ambient level, ambient zones, directional lights (mw-e03.37).'),
    signals: z
      .array(sceneSignalSchema)
      .default([])
      .describe('Signal graphs wiring its switches, volumes and doors (mw-e03.18).'),
    acoustics: sceneAcousticsSchema
      .optional()
      .describe('Rooms, portals and partitions for sound propagation (mw-e09.3).'),
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
      checkMechanism(spawn, index, ctx);
      if (spawn.creature !== undefined) return;
      for (const key of ['faction', 'patrol'] as const) {
        if (spawn[key] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: ['spawns', index, key],
          message: `spawn "${spawn.id}" sets ${key} but spawns no creature`,
        });
      }
    });
    scene.signals.forEach((signal, index) => {
      signal.checkpoints.forEach((node, at) => {
        if (signal.checkpoints.indexOf(node) === at) return;
        ctx.addIssue({
          code: 'custom',
          path: ['signals', index, 'checkpoints', at],
          message: `checkpoint "${node}" is listed twice`,
        });
      });
      for (const [name, id] of Object.entries(signal.bindings)) {
        if (seen.has(id)) continue;
        ctx.addIssue({
          code: 'custom',
          path: ['signals', index, 'bindings', name],
          message: `binding "${name}" names spawn "${id}", which this scene does not have`,
        });
      }
    });
    if (scene.acoustics !== undefined) checkAcoustics(scene.spawns, scene.acoustics, ctx);
  });

type SpawnDef = z.output<typeof sceneSpawnSchema>;

type AcousticsDef = z.output<typeof sceneAcousticsSchema>;

/** Room, portal and partition names must be unique and name what the scene has. */
function checkAcoustics(
  spawns: readonly SpawnDef[],
  acoustics: AcousticsDef,
  ctx: z.RefinementCtx,
): void {
  const { rooms, portals, partitions } = acoustics;
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path: ['acoustics', ...path], message });
  };
  const roomIds = new Set<string>();
  rooms.forEach((room, i) => {
    if (roomIds.has(room.id)) issue(['rooms', i, 'id'], `room id "${room.id}" is used twice`);
    roomIds.add(room.id);
  });
  const doors = new Set(spawns.filter((s) => s.door !== undefined).map((s) => s.id));
  const pair = (list: readonly [string, string], path: (string | number)[], outside: boolean) => {
    list.forEach((id, side) => {
      if (roomIds.has(id) || (outside && id === OUTSIDE_ROOM)) return;
      issue([...path, side], `names room "${id}", which this scene does not have`);
    });
    if (list[0] === list[1]) issue(path, `joins room "${list[0]}" to itself`);
  };
  const portalIds = new Set<string>();
  portals.forEach((portal, i) => {
    if (portalIds.has(portal.id))
      issue(['portals', i, 'id'], `portal id "${portal.id}" is used twice`);
    portalIds.add(portal.id);
    pair(portal.rooms, ['portals', i, 'rooms'], true);
    if (portal.door !== undefined && !doors.has(portal.door)) {
      issue(['portals', i, 'door'], `names door "${portal.door}", which no spawn of this scene is`);
    }
  });
  const pairs = new Set<string>();
  partitions.forEach((partition, i) => {
    pair(partition.rooms, ['partitions', i, 'rooms'], false);
    const key = [...partition.rooms].sort().join('|');
    if (pairs.has(key)) issue(['partitions', i, 'rooms'], 'this partition is listed twice');
    pairs.add(key);
  });
}

/** A spawn's door and switch data must agree with each other and with its other fields. */
function checkMechanism(spawn: SpawnDef, index: number, ctx: z.RefinementCtx): void {
  const issue = (key: string, message: string) => {
    ctx.addIssue({
      code: 'custom',
      path: ['spawns', index, key],
      message: `spawn "${spawn.id}" ${message}`,
    });
  };
  const { door } = spawn;
  if (door !== undefined) {
    if (spawn.switch !== undefined) issue('switch', 'cannot be both a door and a switch');
    if (spawn.interact !== undefined) {
      issue('interact', 'is a door: its affordances follow its state, so it declares none');
    }
    if (door.locked === true && door.lock === undefined)
      issue('door', 'starts locked but has no lock');
  }
  const { container } = spawn;
  if (container !== undefined) {
    const others = [
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['item', 'an item'],
      ['creature', 'a creature'],
    ] as const;
    for (const [key, what] of others) {
      if (spawn[key] !== undefined) issue(key, `cannot be both a container and ${what}`);
    }
    if (spawn.interact !== undefined) {
      issue('interact', 'is a container: its affordances follow its lock, so it declares none');
    }
    if (container.locked === true && container.lock === undefined) {
      issue('container', 'starts locked but has no lock');
    }
  }
  const own = spawn.switch;
  if (own === undefined) return;
  const positions = own.positions ?? (own.kind === 'button' ? 1 : 2);
  if (own.kind !== 'crank' && own.kind !== 'wheel' && own.positions !== undefined) {
    issue('switch', `is a ${own.kind}: only a crank or wheel sets positions`);
  }
  if (own.initial >= positions) {
    issue('switch', `starts in position ${String(own.initial)} of ${String(positions)}`);
  }
}

export type SceneDef = z.output<typeof sceneSchema>;
export type SceneDefInput = z.input<typeof sceneSchema>;
export type ScenePlacementDef = z.output<typeof scenePlacementSchema>;
export type SceneSpawnDef = z.output<typeof sceneSpawnSchema>;
export type SceneLightDef = z.output<typeof sceneLightSchema>;
export type SceneDoorDef = z.output<typeof sceneDoorSchema>;
export type SceneSwitchDef = z.output<typeof sceneSwitchSchema>;
export type SceneSignalDef = z.output<typeof sceneSignalSchema>;
export type SceneContainerDef = z.output<typeof sceneContainerSchema>;
export type SceneAcousticsDef = z.output<typeof sceneAcousticsSchema>;
