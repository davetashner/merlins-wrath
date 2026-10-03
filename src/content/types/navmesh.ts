// Baked navmeshes (mw-e11.4, ADR-0006): `src/content/data/navmesh/<scene>.json`, one per scene that
// creatures navigate. Written by `pnpm nav:bake` from the scene's grey-box geometry, never by hand;
// `pnpm nav:check` (and its unit test) fails when a committed navmesh is stale. The format is the
// sim's NavMeshData (src/sim/nav/format.ts): rectangles of whole bake cells with a planar height,
// the portals between them, off-mesh links (jump, drop, climb) and the doors whose doorways they mark.
// The load-time check (`checkNavmeshes`) ties each navmesh to its scene and the scene's door spawns.

import { z } from 'zod';
import type { NavMeshData } from '@sim/index';
import type { ContentCheck, ContentIssue } from '../loader.ts';
import { contentId } from '../schema.ts';
import { NAV_AREAS, NAV_LINK_KINDS } from './locomotion.ts';
import type { SceneDef } from './scene.ts';

/** The bake version this build reads (the sim's NAV_BAKE_VERSION; a test keeps them equal). */
export const NAVMESH_VERSION = 1;

const cell = z.int().describe('Cell index.');
const metres = z.number().describe('Metres.');
const index = z.int().min(0);

const settingsSchema = z
  .strictObject({
    cellSize: z.number().positive().describe('Bake cell size, m.'),
    agentRadius: z.number().positive().describe('Agent radius the walkable area is shrunk by, m.'),
    agentHeight: z.number().positive().describe('Headroom a walkable surface needs, m.'),
    stepHeight: z.number().nonnegative().describe('Tallest step between neighbouring cells, m.'),
    maxSlope: z.number().min(0).lt(90).describe('Steepest walkable slope, degrees.'),
    maxJump: z.number().nonnegative().describe('Highest jump link baked, m.'),
    maxDrop: z.number().nonnegative().describe('Highest drop link baked, m.'),
  })
  .describe('The agent and grid it was baked for; `pnpm nav:bake` keeps them on a re-bake.');

const polySchema = z
  .tuple([
    cell,
    cell,
    cell,
    cell,
    metres,
    metres,
    metres,
    z
      .int()
      .min(0)
      .max(NAV_AREAS.length - 1),
    z.int().min(-1),
  ])
  .describe(
    '[i0, k0, i1, k1, a, gx, gz, area, door]: cells [i0, i1) × [k0, k1), y = a + gx·x + gz·z.',
  );

const portalSchema = z
  .tuple([index, index, cell, cell, cell, cell])
  .describe('[a, b, i0, k0, i1, k1]: polygons a < b share the edge (i0, k0)–(i1, k1).');

const linkSchema = z
  .tuple([
    z
      .int()
      .min(0)
      .max(NAV_LINK_KINDS.length - 1),
    index,
    index,
    metres,
    metres,
    metres,
    metres,
    metres,
    metres,
    z.number().nonnegative(),
  ])
  .describe('[kind, from, to, ax, ay, az, bx, by, bz, measure]: one-way off-mesh link.');

export const navmeshSchema = z
  .strictObject({
    id: contentId.describe('The scene it was baked from (its id).'),
    version: z.literal(NAVMESH_VERSION).describe('Bake version.'),
    source: z
      .string()
      .regex(/^[0-9a-f]{8}$/)
      .describe('Fingerprint of everything the bake read.'),
    settings: settingsSchema,
    origin: z.tuple([metres, metres]).describe('World x, z of cell corner (0, 0), m.'),
    polys: z
      .array(polySchema)
      .describe(
        'Walkable rectangles, one row each: [i0, k0, i1, k1, a, gx, gz, area, door] — cells [i0, i1) × [k0, k1), surface y = a + gx·x + gz·z, nav area index, door index or −1.',
      ),
    portals: z
      .array(portalSchema)
      .describe(
        'Edges shared by two rectangles: [a, b, i0, k0, i1, k1] — polygons a < b, edge from cell corner (i0, k0) to (i1, k1).',
      ),
    links: z
      .array(linkSchema)
      .describe(
        'Off-mesh links, one way: [kind, from, to, ax, ay, az, bx, by, bz, measure] — kind index (jump, drop, climb…), polygons, end points in metres, rise/fall or climb grade.',
      ),
    doors: z.array(contentId).describe('Door spawn ids; a polygon’s `door` indexes this list.'),
  })
  .superRefine((mesh, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const polys = mesh.polys.length;
    mesh.polys.forEach(([i0, k0, i1, k1, , , , , door], p) => {
      if (i1 <= i0 || k1 <= k0) issue(['polys', p], 'is an empty rectangle');
      if (door >= mesh.doors.length)
        issue(['polys', p, 8], `names door ${String(door)} of ${String(mesh.doors.length)}`);
    });
    mesh.portals.forEach(([a, b], n) => {
      if (a >= b || b >= polys)
        issue(['portals', n], `joins polygons ${String(a)} and ${String(b)} of ${String(polys)}`);
    });
    mesh.links.forEach(([, from, to], n) => {
      if (from >= polys || to >= polys)
        issue(['links', n], `joins polygons ${String(from)} and ${String(to)} of ${String(polys)}`);
    });
  });

/** A navmesh as written in a data file. */
export type NavmeshDefInput = z.input<typeof navmeshSchema>;
/** A loaded navmesh. */
export type NavmeshDef = z.output<typeof navmeshSchema> & NavMeshData;

/** The content check for navmeshes: each is baked from a scene, and its doors are door spawns there. */
export const checkNavmeshes: ContentCheck = (entries) => {
  const scenes = new Map<string, SceneDef>();
  for (const { type, value } of entries)
    if (type === 'scene') scenes.set(value.id, value as SceneDef);
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'navmesh') continue;
    const mesh = value as NavmeshDef;
    const scene = scenes.get(mesh.id);
    if (scene === undefined) {
      issues.push({
        file,
        pointer: '/id',
        message: `navmesh:${mesh.id} has no scene "${mesh.id}" to belong to`,
      });
      continue;
    }
    const doors = new Set(scene.spawns.filter((s) => s.door !== undefined).map((s) => s.id));
    mesh.doors.forEach((door, n) => {
      if (doors.has(door)) return;
      issues.push({
        file,
        pointer: `/doors/${String(n)}`,
        message: `navmesh:${mesh.id} names door "${door}", which scene:${mesh.id} has no door spawn for (re-run pnpm nav:bake)`,
      });
    });
  }
  return issues;
};
