// The baked navmesh as stored data (mw-e11.4, ADR-0006). `bakeNavMesh` (./bake.ts) writes it at
// content build time (`pnpm nav:bake` → src/content/data/navmesh/<scene>.json) and `NavMesh`
// (./mesh.ts) reads it at run time. It is plain JSON so content validation, saves of a level and
// state hashes never meet a binary blob.
//
// Grey-box geometry is axis-aligned boxes and quarter-turn wedges, so the mesh is too: every polygon
// is an axis-aligned rectangle of whole bake cells with a planar height (flat floors, or a ramp's
// slope). Rectangle corners and portal endpoints are integer cell coordinates (exact), heights are
// metres. Cell (i, k) covers x ∈ [origin.x + i·cell, origin.x + (i + 1)·cell), likewise z.
//
// - `polys[p]` = [i0, k0, i1, k1, a, gx, gz, area, door]: cells [i0, i1) × [k0, k1); the surface is
//   y = a + gx·x + gz·z (world metres); `area` indexes NAV_AREA_NAMES; `door` indexes `doors`, or −1.
// - `portals[n]` = [a, b, i0, k0, i1, k1]: polygons a < b share the edge from cell corner (i0, k0) to
//   (i1, k1), walkable both ways.
// - `links[n]` = [kind, from, to, ax, ay, az, bx, by, bz, measure]: an off-mesh link one way from
//   polygon `from` at point a to polygon `to` at point b (metres); `kind` indexes NAV_LINK_KIND_NAMES;
//   `measure` is the rise (jump), fall (drop) or climb grade 1–3 (climb).
// - `doors[d]` = the scene spawn id of the door whose doorway polygons carry `door = d`.

/** Bumped whenever the bake's output for the same input changes (stale navmeshes fail the check). */
export const NAV_BAKE_VERSION = 1;

/** Nav areas, in the order content's NAV_AREAS lists them (the stored `area` index). */
export const NAV_AREA_NAMES = ['ground', 'water-shallow', 'water-deep', 'crawlspace'] as const;
export type NavAreaName = (typeof NAV_AREA_NAMES)[number];

/** Off-mesh link kinds, in the order content's NAV_LINK_KINDS lists them (the stored index). */
export const NAV_LINK_KIND_NAMES = ['jump', 'drop', 'climb', 'door', 'fly', 'burrow'] as const;
export type NavLinkKindName = (typeof NAV_LINK_KIND_NAMES)[number];

/** The agent and grid a navmesh was baked for. */
export interface NavBakeSettings {
  /** Bake cell size, metres (0.125 keeps every cell corner exact in binary). */
  readonly cellSize: number;
  /** Agent radius the walkable area is shrunk by, metres. */
  readonly agentRadius: number;
  /** Headroom a walkable surface needs, metres. */
  readonly agentHeight: number;
  /** Tallest step walked up between neighbouring cells, metres. */
  readonly stepHeight: number;
  /** Steepest walkable slope, degrees. */
  readonly maxSlope: number;
  /** Highest jump link the bake makes, metres (agents filter by their own jumpHeight). */
  readonly maxJump: number;
  /** Highest drop link the bake makes, metres (agents filter by their own maxDrop). */
  readonly maxDrop: number;
}

/** One polygon: [i0, k0, i1, k1, a, gx, gz, area, door]. */
export type NavPolyRow = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** One portal: [a, b, i0, k0, i1, k1]. */
export type NavPortalRow = readonly [number, number, number, number, number, number];

/** One off-mesh link: [kind, from, to, ax, ay, az, bx, by, bz, measure]. */
export type NavLinkRow = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** A baked navmesh (content `navmesh`). */
export interface NavMeshData {
  /** The scene id; the navmesh's content id. */
  readonly id: string;
  readonly version: number;
  /** Fingerprint of everything the bake read (geometry, doors, climbables, settings, version). */
  readonly source: string;
  readonly settings: NavBakeSettings;
  /** World x, z of cell corner (0, 0), metres. */
  readonly origin: readonly [number, number];
  readonly polys: readonly NavPolyRow[];
  readonly portals: readonly NavPortalRow[];
  readonly links: readonly NavLinkRow[];
  readonly doors: readonly string[];
}
